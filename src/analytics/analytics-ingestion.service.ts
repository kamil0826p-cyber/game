import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { GameConfigService } from '../config/game-config.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { DomainEventService } from '../domain-events/domain-event.service.js';
import type { DomainEventRecord } from '../domain-events/domain-event.types.js';
import { Prisma } from '../generated/prisma/client.js';
import { CRITICAL_ANALYTICS_EVENTS, deterministicSample, toAnalyticsEnvelope } from './analytics-sanitizer.js';
import { ANALYTICS_CONSUMER } from './analytics.types.js';
import { AnalyticsProviderService } from './analytics-provider.service.js';

@Injectable()
export class AnalyticsIngestionService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AnalyticsIngestionService.name);
  private timer?: ReturnType<typeof setInterval>;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private running?: Promise<number>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventService,
    private readonly config: GameConfigService,
    private readonly provider: AnalyticsProviderService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.values.ANALYTICS_ENABLED) return;
    this.timer = setInterval(() => void this.ingestNow(), this.config.values.ANALYTICS_INGEST_INTERVAL_MS);
    this.timer.unref?.();
    this.cleanupTimer = setInterval(() => void this.cleanup(), 6 * 60 * 60 * 1000);
    this.cleanupTimer.unref?.();
    void this.ingestNow();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    await this.running?.catch(() => undefined);
    for (let index = 0; index < 5; index += 1) {
      const processed = await this.ingestNow().catch(() => 0);
      if (processed === 0) break;
    }
  }

  ingestNow(): Promise<number> {
    if (!this.config.values.ANALYTICS_ENABLED) return Promise.resolve(0);
    if (this.running) return this.running;
    const run = this.ingestBatch().catch((error: unknown) => {
      this.logger.error('Analytics ingestion failed without affecting gameplay.', error instanceof Error ? error.stack : undefined);
      return 0;
    }).finally(() => {
      if (this.running === run) this.running = undefined;
    });
    this.running = run;
    return run;
  }

  private async ingestBatch(): Promise<number> {
    if (this.provider.active) {
      const pending = await this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS "count" FROM "AnalyticsDelivery"
        WHERE "status" IN ('PENDING', 'PROCESSING', 'FAILED')
      `);
      if (Number(pending[0]?.count ?? 0) >= this.config.values.ANALYTICS_QUEUE_CAPACITY) return 0;
    }

    const rows = await this.prisma.$queryRaw<DomainEventRecord[]>(Prisma.sql`
      SELECT event.*
      FROM "DomainEvent" AS event
      LEFT JOIN "EventInbox" AS receipt
        ON receipt."eventId" = event."id" AND receipt."consumer" = ${ANALYTICS_CONSUMER}
      WHERE receipt."eventId" IS NULL
      ORDER BY event."createdAt", event."id"
      LIMIT ${this.config.values.ANALYTICS_INGEST_BATCH_SIZE}
    `);

    let processed = 0;
    for (const event of rows) {
      const result = await this.events.consumeExactlyOnce(ANALYTICS_CONSUMER, event.id, async (tx, current) => {
        const sampled = CRITICAL_ANALYTICS_EVENTS.has(current.type) ||
          deterministicSample(current.id, this.config.values.ANALYTICS_SAMPLE_BASIS_POINTS);
        if (!sampled) return false;

        let accountId = (current.payload as Record<string, unknown>).accountId;
        if (typeof accountId !== 'string') accountId = undefined;
        if (!accountId && current.actorCharacterId) {
          const character = await tx.character.findUnique({
            where: { id: current.actorCharacterId },
            select: { userId: true },
          });
          accountId = character?.userId;
        }
        const envelope = toAnalyticsEnvelope({
          event: current,
          accountId: typeof accountId === 'string' ? accountId : undefined,
          contentVersion: this.config.values.GAME_CONTENT_VERSION,
        });
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "AnalyticsEvent" (
            "id", "eventId", "eventName", "envelopeVersion", "sourceType", "sourceSchemaVersion",
            "accountId", "characterId", "realmId", "mapId", "regionKey", "sessionId", "clientVersion",
            "contentVersion", "operationId", "correlationId", "occurredAt", "ingestedAt", "properties"
          ) VALUES (
            ${randomUUID()}::uuid, ${current.id}::uuid, ${envelope.eventName}, ${envelope.envelopeVersion},
            ${current.type}, ${current.schemaVersion}, ${envelope.accountId ?? null}::uuid,
            ${envelope.characterId ?? null}::uuid, ${envelope.realmId ?? null}::uuid,
            ${envelope.mapId ?? null}::uuid, ${envelope.regionKey ?? null}, ${envelope.sessionId ?? null},
            ${envelope.clientVersion ?? null}, ${envelope.contentVersion}, ${envelope.operationId},
            ${envelope.correlationId}, ${current.occurredAt}, NOW(), ${JSON.stringify(envelope.properties)}::jsonb
          ) ON CONFLICT ("eventId") DO NOTHING
        `);
        const provider = this.provider.active;
        if (provider) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO "AnalyticsDelivery" (
              "id", "analyticsEventId", "provider", "status", "attempts", "nextAttemptAt", "createdAt", "updatedAt"
            ) SELECT ${randomUUID()}::uuid, "id", ${provider.kind}, 'PENDING', 0, NOW(), NOW(), NOW()
            FROM "AnalyticsEvent" WHERE "eventId" = ${current.id}::uuid
            ON CONFLICT ("analyticsEventId", "provider") DO NOTHING
          `);
        }
        return true;
      });
      if (result.processed) processed += 1;
    }
    return processed;
  }

  private async cleanup(): Promise<void> {
    const retentionDays = this.config.values.ANALYTICS_RETENTION_DAYS;
    await this.prisma.$executeRaw(Prisma.sql`
      DELETE FROM "AnalyticsEvent"
      WHERE "occurredAt" < NOW() - (${retentionDays} * INTERVAL '1 day')
        AND NOT EXISTS (
          SELECT 1 FROM "AnalyticsDelivery" delivery
          WHERE delivery."analyticsEventId" = "AnalyticsEvent"."id"
            AND delivery."status" IN ('PENDING', 'PROCESSING', 'FAILED')
        )
    `).catch((error: unknown) => {
      this.logger.error('Analytics retention cleanup failed.', error instanceof Error ? error.stack : undefined);
    });
  }
}
