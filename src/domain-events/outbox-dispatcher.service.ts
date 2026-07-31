import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { GameConfigService } from '../config/game-config.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { DomainEventService } from './domain-event.service.js';
import type { DomainContribution, DomainEventRecord } from './domain-event.types.js';

interface ClaimedOutbox {
  id: string;
  eventId: string;
  attempts: number;
}

@Injectable()
export class OutboxDispatcherService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxDispatcherService.name);
  private timer?: ReturnType<typeof setInterval>;
  private dispatching?: Promise<void>;
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventService,
    private readonly config: GameConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.values.OUTBOX_ENABLED) return;
    this.timer = setInterval(
      () => void this.dispatchNow(),
      this.config.values.OUTBOX_POLL_INTERVAL_MS,
    );
    this.timer.unref?.();
    void this.dispatchNow();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    await this.dispatching;
  }

  async dispatchNow(): Promise<void> {
    if (this.stopping) return;
    if (this.dispatching) return this.dispatching;
    const work = this.dispatchLoop().finally(() => {
      if (this.dispatching === work) this.dispatching = undefined;
    });
    this.dispatching = work;
    return work;
  }

  private async dispatchLoop(): Promise<void> {
    while (!this.stopping) {
      const claimed = await this.claimBatch();
      if (claimed.length === 0) return;
      for (const entry of claimed) await this.process(entry);
    }
  }

  private claimBatch(): Promise<ClaimedOutbox[]> {
    const batchSize = this.config.values.OUTBOX_BATCH_SIZE;
    return this.prisma.$transaction((tx) => tx.$queryRaw<ClaimedOutbox[]>(Prisma.sql`
      WITH candidates AS (
        SELECT "id"
        FROM "EventOutbox"
        WHERE (("status" IN ('PENDING', 'FAILED') AND "nextAttemptAt" <= NOW())
          OR ("status" = 'PROCESSING' AND "lockedAt" < NOW() - INTERVAL '5 minutes'))
        ORDER BY "createdAt"
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
      UPDATE "EventOutbox" AS outbox
      SET "status" = 'PROCESSING', "attempts" = outbox."attempts" + 1,
          "lockedAt" = NOW(), "updatedAt" = NOW()
      FROM candidates
      WHERE outbox."id" = candidates."id"
      RETURNING outbox."id", outbox."eventId", outbox."attempts"
    `));
  }

  private async process(entry: ClaimedOutbox): Promise<void> {
    try {
      await this.events.consumeExactlyOnce('core-contribution-ledger', entry.eventId, async (tx, event) => {
        await this.applyContributions(tx, event);
      });
      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE "EventOutbox"
        SET "status" = 'PUBLISHED', "publishedAt" = NOW(), "lockedAt" = NULL,
            "lastError" = NULL, "updatedAt" = NOW()
        WHERE "id" = ${entry.id}::uuid
      `);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const dead = entry.attempts >= this.config.values.OUTBOX_MAX_ATTEMPTS;
      const backoffSeconds = Math.min(300, 2 ** Math.min(entry.attempts, 8));
      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE "EventOutbox"
        SET "status" = ${dead ? 'DEAD' : 'FAILED'},
            "nextAttemptAt" = NOW() + (${backoffSeconds} * INTERVAL '1 second'),
            "lockedAt" = NULL, "lastError" = ${message}, "updatedAt" = NOW()
        WHERE "id" = ${entry.id}::uuid
      `);
      const log = dead ? this.logger.error.bind(this.logger) : this.logger.warn.bind(this.logger);
      log(`Outbox ${entry.id} failed on attempt ${entry.attempts}: ${message}`);
    }
  }

  private async applyContributions(
    tx: Prisma.TransactionClient,
    event: DomainEventRecord,
  ): Promise<void> {
    const payload = event.payload as unknown as { contributions?: DomainContribution[] };
    for (const contribution of payload.contributions ?? []) {
      if (!Number.isInteger(contribution.amount) || contribution.amount < 1) {
        throw new Error(`Event ${event.id} has an invalid contribution amount.`);
      }
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "ContributionLedger" (
          "id", "eventId", "operationId", "subjectType", "subjectId", "kind",
          "amount", "metadata", "createdAt"
        ) VALUES (
          ${randomUUID()}::uuid, ${event.id}::uuid, ${event.operationId},
          ${contribution.subjectType}, ${contribution.subjectId}, ${contribution.kind},
          ${contribution.amount}, ${JSON.stringify(contribution.metadata ?? {})}::jsonb, NOW()
        )
        ON CONFLICT ("eventId", "subjectType", "subjectId", "kind") DO NOTHING
      `);
    }
  }
}
