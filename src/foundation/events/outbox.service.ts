import { createHash, randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  analyticsProviderConfigFromEnvironment,
  createAnalyticsProvider,
  type AnalyticsProvider,
} from '../analytics/analytics.provider.js';
import { sanitizeAnalyticsPayload } from '../analytics/payload-sanitizer.js';
import {
  isCriticalDomainEvent,
  type DomainEventEnvelope,
} from './domain-event.types.js';

interface ClaimedOutboxEvent {
  outboxId: bigint;
  attempts: number;
  id: string;
  eventType: string;
  eventVersion: number;
  occurredAt: Date;
  serverTime: Date;
  realmId: string | null;
  mapId: string | null;
  characterId: string | null;
  accountId: string | null;
  sessionId: string | null;
  operationId: string | null;
  correlationId: string | null;
  contentHash: string | null;
  clientVersion: string | null;
  payload: unknown;
}

export interface OutboxConfiguration {
  pollIntervalMs: number;
  batchSize: number;
  maxAttempts: number;
  lockTimeoutMs: number;
  retentionDays: number;
  sampleBasisPoints: number;
}

const integer = (
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number => {
  const parsed = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
};

export function outboxConfigurationFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): OutboxConfiguration {
  return {
    pollIntervalMs: integer(
      environment.OUTBOX_POLL_INTERVAL_MS,
      1_000,
      100,
      60_000,
      'OUTBOX_POLL_INTERVAL_MS',
    ),
    batchSize: integer(
      environment.OUTBOX_BATCH_SIZE,
      100,
      1,
      1_000,
      'OUTBOX_BATCH_SIZE',
    ),
    maxAttempts: integer(
      environment.OUTBOX_MAX_ATTEMPTS,
      10,
      1,
      100,
      'OUTBOX_MAX_ATTEMPTS',
    ),
    lockTimeoutMs: integer(
      environment.OUTBOX_LOCK_TIMEOUT_MS,
      60_000,
      1_000,
      3_600_000,
      'OUTBOX_LOCK_TIMEOUT_MS',
    ),
    retentionDays: integer(
      environment.ANALYTICS_RETENTION_DAYS,
      90,
      1,
      3_650,
      'ANALYTICS_RETENTION_DAYS',
    ),
    sampleBasisPoints: integer(
      environment.ANALYTICS_SAMPLE_BASIS_POINTS,
      10_000,
      0,
      10_000,
      'ANALYTICS_SAMPLE_BASIS_POINTS',
    ),
  };
}

export function retryDelayMs(attempt: number): number {
  const normalized = Math.max(1, Math.floor(attempt));
  return Math.min(
    60 * 60 * 1_000,
    1_000 * 2 ** Math.min(12, normalized - 1),
  );
}

export function deterministicSampleBucket(eventId: string): number {
  const digest = createHash('sha256').update(eventId).digest();
  return digest.readUInt32BE(0) % 10_000;
}

function compactEnvelope(row: ClaimedOutboxEvent): DomainEventEnvelope {
  return {
    id: row.id,
    eventType: row.eventType,
    eventVersion: row.eventVersion,
    occurredAt: row.occurredAt,
    serverTime: row.serverTime,
    ...(row.realmId ? { realmId: row.realmId } : {}),
    ...(row.mapId ? { mapId: row.mapId } : {}),
    ...(row.characterId ? { characterId: row.characterId } : {}),
    ...(row.accountId ? { accountId: row.accountId } : {}),
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    ...(row.operationId ? { operationId: row.operationId } : {}),
    ...(row.correlationId ? { correlationId: row.correlationId } : {}),
    ...(row.contentHash ? { contentHash: row.contentHash } : {}),
    ...(row.clientVersion ? { clientVersion: row.clientVersion } : {}),
    payload: sanitizeAnalyticsPayload(row.payload),
  };
}

@Injectable()
export class OutboxService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxService.name);
  private readonly workerId = `${process.pid}:${randomUUID()}`;
  private readonly configuration = outboxConfigurationFromEnvironment();
  private readonly provider: AnalyticsProvider = createAnalyticsProvider(
    analyticsProviderConfigFromEnvironment(),
    this.logger,
  );
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;
  private lastRetentionCleanup = 0;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (process.env.OUTBOX_WORKER_ENABLED === 'false') {
      this.logger.log('Outbox worker is disabled.');
      return;
    }
    this.schedule(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  async drainOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const claimed = await this.claimBatch();
      if (claimed.length === 0) {
        await this.cleanupRetentionIfDue();
        return 0;
      }

      const sampledOut = claimed.filter(
        (row) =>
          !isCriticalDomainEvent(row.eventType) &&
          deterministicSampleBucket(row.id) >=
            this.configuration.sampleBasisPoints,
      );
      const publishable = claimed.filter((row) => !sampledOut.includes(row));
      if (sampledOut.length > 0) {
        await this.markDelivered(sampledOut.map((row) => row.outboxId));
      }
      if (publishable.length > 0) {
        try {
          await this.provider.publish(publishable.map(compactEnvelope));
          await this.markDelivered(publishable.map((row) => row.outboxId));
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          await this.markFailed(publishable, message);
          this.logger.warn(
            `Analytics delivery failed without blocking gameplay: ${message}`,
          );
        }
      }
      await this.cleanupRetentionIfDue();
      return claimed.length;
    } finally {
      this.running = false;
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.drainOnce()
        .catch((error: unknown) => {
          this.logger.error(
            'Outbox worker iteration failed.',
            error instanceof Error ? error.stack : String(error),
          );
        })
        .finally(() => this.schedule(this.configuration.pollIntervalMs));
    }, delayMs);
    this.timer.unref?.();
  }

  private async claimBatch(): Promise<ClaimedOutboxEvent[]> {
    const lockTimeoutSeconds = this.configuration.lockTimeoutMs / 1_000;
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw(Prisma.sql`
        UPDATE "DomainOutbox"
        SET "status" = 'PENDING',
            "availableAt" = CURRENT_TIMESTAMP,
            "lockedAt" = NULL,
            "lockedBy" = NULL,
            "lastError" = COALESCE("lastError", 'Recovered abandoned lock')
        WHERE "status" = 'PROCESSING'
          AND "lockedAt" < CURRENT_TIMESTAMP - make_interval(secs => ${lockTimeoutSeconds})
      `);

      return transaction.$queryRaw<ClaimedOutboxEvent[]>(Prisma.sql`
        WITH candidates AS (
          SELECT "id"
          FROM "DomainOutbox"
          WHERE "status" = 'PENDING'
            AND "availableAt" <= CURRENT_TIMESTAMP
          ORDER BY "id"
          FOR UPDATE SKIP LOCKED
          LIMIT ${this.configuration.batchSize}
        ), claimed AS (
          UPDATE "DomainOutbox" outbox
          SET "status" = 'PROCESSING',
              "attempts" = outbox."attempts" + 1,
              "lockedAt" = CURRENT_TIMESTAMP,
              "lockedBy" = ${this.workerId}
          FROM candidates
          WHERE outbox."id" = candidates."id"
          RETURNING outbox."id", outbox."attempts", outbox."eventId"
        )
        SELECT
          claimed."id" AS "outboxId",
          claimed."attempts",
          event."id",
          event."eventType",
          event."eventVersion",
          event."occurredAt",
          event."serverTime",
          event."realmId",
          event."mapId",
          event."characterId",
          event."accountId",
          event."sessionId",
          event."operationId",
          event."correlationId",
          event."contentHash",
          event."clientVersion",
          event."payload"
        FROM claimed
        JOIN "DomainEvent" event ON event."id" = claimed."eventId"
        ORDER BY claimed."id"
      `);
    });
  }

  private async markDelivered(outboxIds: readonly bigint[]): Promise<void> {
    if (outboxIds.length === 0) return;
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "DomainOutbox"
      SET "status" = 'DELIVERED',
          "deliveredAt" = CURRENT_TIMESTAMP,
          "lockedAt" = NULL,
          "lockedBy" = NULL,
          "lastError" = NULL
      WHERE "id" IN (${Prisma.join(outboxIds)})
        AND "lockedBy" = ${this.workerId}
    `);
  }

  private async markFailed(
    rows: readonly ClaimedOutboxEvent[],
    message: string,
  ): Promise<void> {
    for (const row of rows) {
      const dead = row.attempts >= this.configuration.maxAttempts;
      const delaySeconds = retryDelayMs(row.attempts) / 1_000;
      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE "DomainOutbox"
        SET "status" = ${dead ? 'DEAD' : 'PENDING'},
            "availableAt" = CASE
              WHEN ${dead} THEN "availableAt"
              ELSE CURRENT_TIMESTAMP + make_interval(secs => ${delaySeconds})
            END,
            "lockedAt" = NULL,
            "lockedBy" = NULL,
            "lastError" = ${message.slice(0, 4_000)}
        WHERE "id" = ${row.outboxId}
          AND "lockedBy" = ${this.workerId}
      `);
    }
  }

  private async cleanupRetentionIfDue(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRetentionCleanup < 24 * 60 * 60 * 1_000) return;
    this.lastRetentionCleanup = now;
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw(Prisma.sql`
        DELETE FROM "DomainOutbox"
        WHERE (
          "status" = 'DELIVERED'
          AND "deliveredAt" < CURRENT_TIMESTAMP - make_interval(days => ${this.configuration.retentionDays})
        ) OR (
          "status" = 'DEAD'
          AND "createdAt" < CURRENT_TIMESTAMP - make_interval(days => ${this.configuration.retentionDays})
        )
      `);
      await transaction.$executeRaw(Prisma.sql`
        DELETE FROM "DomainEvent" event
        WHERE event."createdAt" < CURRENT_TIMESTAMP - make_interval(days => ${this.configuration.retentionDays})
          AND NOT EXISTS (
            SELECT 1 FROM "DomainOutbox" outbox WHERE outbox."eventId" = event."id"
          )
          AND NOT EXISTS (
            SELECT 1 FROM "DomainInbox" inbox WHERE inbox."eventId" = event."id"
          )
      `);
    });
  }
}
