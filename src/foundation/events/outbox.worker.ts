import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AnalyticsDispatcher } from '../analytics/analytics.provider.js';
import type { DomainEventEnvelope } from './domain-event.types.js';

interface ClaimedOutboxRow {
  id: string;
  eventId: string;
  attempts: number;
}

const integerEnvironment = (
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
};

const booleanEnvironment = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name];
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw.toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(raw.toLowerCase())) return false;
  throw new Error(`${name} must be a boolean.`);
};

const retryDelayMs = (attempt: number): number =>
  Math.min(60_000, 500 * 2 ** Math.max(0, attempt - 1));

@Injectable()
export class OutboxWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxWorker.name);
  private readonly workerId = randomUUID();
  private readonly enabled = booleanEnvironment('OUTBOX_WORKER_ENABLED', true);
  private readonly batchSize = integerEnvironment('OUTBOX_BATCH_SIZE', 50, 1, 500);
  private readonly intervalMs = integerEnvironment(
    'OUTBOX_POLL_INTERVAL_MS',
    1_000,
    100,
    60_000,
  );
  private readonly staleLockSeconds = integerEnvironment(
    'OUTBOX_STALE_LOCK_SECONDS',
    120,
    10,
    3_600,
  );
  private readonly maxAttempts = integerEnvironment('OUTBOX_MAX_ATTEMPTS', 8, 1, 100);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsDispatcher,
  ) {}

  onModuleInit(): void {
    if (!this.enabled) return;
    this.timer = setInterval(() => void this.processOnce(), this.intervalMs);
    this.timer.unref();
    void this.processOnce();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async processOnce(): Promise<number> {
    if (this.running || !this.enabled) return 0;
    this.running = true;
    try {
      const claimed = await this.claimBatch();
      for (const row of claimed) await this.processClaim(row);
      return claimed.length;
    } catch (error: unknown) {
      this.logger.error(
        'Outbox polling failed.',
        error instanceof Error ? error.stack : String(error),
      );
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async claimBatch(): Promise<ClaimedOutboxRow[]> {
    const staleBefore = new Date(Date.now() - this.staleLockSeconds * 1_000);
    return this.prisma.$transaction((transaction) =>
      transaction.$queryRaw<ClaimedOutboxRow[]>`
        WITH candidates AS (
          SELECT "id"
          FROM "EventOutbox"
          WHERE "availableAt" <= NOW()
            AND (
              "status" = 'PENDING'::"OutboxStatus"
              OR (
                "status" = 'PROCESSING'::"OutboxStatus"
                AND ("lockedAt" IS NULL OR "lockedAt" < ${staleBefore})
              )
            )
          ORDER BY "createdAt" ASC
          LIMIT ${this.batchSize}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "EventOutbox" AS outbox
        SET "status" = 'PROCESSING'::"OutboxStatus",
            "lockedAt" = NOW(),
            "lockedBy" = ${this.workerId},
            "attempts" = outbox."attempts" + 1,
            "updatedAt" = NOW()
        FROM candidates
        WHERE outbox."id" = candidates."id"
        RETURNING outbox."id", outbox."eventId", outbox."attempts"
      `,
    );
  }

  private async processClaim(claim: ClaimedOutboxRow): Promise<void> {
    const event = await this.prisma.domainEvent.findUnique({
      where: { id: claim.eventId },
    });
    if (!event) {
      await this.failClaim(claim, new Error(`Domain event ${claim.eventId} no longer exists.`));
      return;
    }

    const envelope: DomainEventEnvelope = {
      id: event.id,
      type: event.type,
      version: event.version,
      occurredAt: event.occurredAt,
      realmId: event.realmId ?? undefined,
      mapId: event.mapId ?? undefined,
      characterId: event.characterId ?? undefined,
      accountId: event.accountId ?? undefined,
      sessionId: event.sessionId ?? undefined,
      operationId: event.operationId ?? undefined,
      correlationId: event.correlationId ?? undefined,
      contentVersionHash: event.contentVersionHash ?? undefined,
      clientVersion: event.clientVersion ?? undefined,
      payload: event.payload,
      critical: event.critical,
    };

    try {
      await this.analytics.dispatch(envelope);
      await this.prisma.eventOutbox.update({
        where: { id: claim.id },
        data: {
          status: 'DELIVERED',
          deliveredAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          lastError: null,
        },
      });
    } catch (error: unknown) {
      await this.failClaim(claim, error);
    }
  }

  private async failClaim(claim: ClaimedOutboxRow, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    if (claim.attempts >= this.maxAttempts) {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.eventDeadLetter.upsert({
          where: { outboxId: claim.id },
          create: {
            outboxId: claim.id,
            eventId: claim.eventId,
            attempts: claim.attempts,
            error: message.slice(0, 4_000),
          },
          update: {
            attempts: claim.attempts,
            error: message.slice(0, 4_000),
          },
        });
        await transaction.eventOutbox.update({
          where: { id: claim.id },
          data: {
            status: 'DEAD_LETTER',
            lockedAt: null,
            lockedBy: null,
            lastError: message.slice(0, 4_000),
          },
        });
      });
      this.logger.error(
        `Event ${claim.eventId} moved to dead letter after ${claim.attempts} attempts.`,
      );
      return;
    }

    await this.prisma.eventOutbox.update({
      where: { id: claim.id },
      data: {
        status: 'PENDING',
        availableAt: new Date(Date.now() + retryDelayMs(claim.attempts)),
        lockedAt: null,
        lockedBy: null,
        lastError: message.slice(0, 4_000),
      },
    });
  }
}

export type TransactionalEventEffect = (
  transaction: Prisma.TransactionClient,
) => Promise<void>;

@Injectable()
export class ExactlyOnceEventConsumer {
  constructor(private readonly prisma: PrismaService) {}

  async consume(
    consumer: string,
    eventId: string,
    effect: TransactionalEventEffect,
  ): Promise<'processed' | 'duplicate'> {
    return this.prisma.$transaction(async (transaction) => {
      const claimed = await transaction.eventInbox.createMany({
        data: [{ consumer, eventId }],
        skipDuplicates: true,
      });
      if (claimed.count === 0) return 'duplicate';
      await effect(transaction);
      return 'processed';
    });
  }
}
