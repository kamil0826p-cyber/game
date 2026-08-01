import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { GameConfigService } from '../config/game-config.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { AnalyticsProviderService } from './analytics-provider.service.js';
import type { AnalyticsEnvelope, ClaimedAnalyticsDelivery } from './analytics.types.js';

interface RawDelivery {
  id: string;
  analyticsEventId: string;
  attempts: number;
  eventId: string;
  eventName: string;
  envelopeVersion: number;
  sourceType: AnalyticsEnvelope['sourceType'];
  sourceSchemaVersion: number;
  accountId: string | null;
  characterId: string | null;
  realmId: string | null;
  mapId: string | null;
  regionKey: string | null;
  sessionId: string | null;
  clientVersion: string | null;
  contentVersion: string;
  operationId: string;
  correlationId: string;
  occurredAt: Date;
  ingestedAt: Date;
  properties: Prisma.JsonValue;
}

@Injectable()
export class AnalyticsDispatcherService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AnalyticsDispatcherService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<number>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
    private readonly provider: AnalyticsProviderService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.provider.active) return;
    this.timer = setInterval(() => void this.dispatchNow(), this.config.values.ANALYTICS_DISPATCH_INTERVAL_MS);
    this.timer.unref?.();
    void this.dispatchNow();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running?.catch(() => undefined);
    for (let index = 0; index < 5; index += 1) {
      const processed = await this.dispatchNow().catch(() => 0);
      if (processed === 0) break;
    }
  }

  dispatchNow(): Promise<number> {
    if (!this.provider.active) return Promise.resolve(0);
    if (this.running) return this.running;
    const run = this.dispatchBatch().catch((error: unknown) => {
      this.logger.error('Analytics delivery failed without affecting gameplay.', error instanceof Error ? error.stack : undefined);
      return 0;
    }).finally(() => {
      if (this.running === run) this.running = undefined;
    });
    this.running = run;
    return run;
  }

  private async dispatchBatch(): Promise<number> {
    const provider = this.provider.active;
    if (!provider) return 0;
    const claimed = await this.claim(provider.kind);
    if (claimed.length === 0) return 0;
    try {
      await provider.send(claimed.map((entry) => entry.envelope));
      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE "AnalyticsDelivery"
        SET "status" = 'SENT', "sentAt" = NOW(), "lockedAt" = NULL, "lastError" = NULL, "updatedAt" = NOW()
        WHERE "id" IN (${Prisma.join(claimed.map((entry) => Prisma.sql`${entry.id}::uuid`))})
          AND "status" = 'PROCESSING'
      `);
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000);
      for (const entry of claimed) {
        const dead = entry.attempts >= this.config.values.ANALYTICS_MAX_ATTEMPTS;
        const delaySeconds = Math.min(3600, 2 ** Math.min(12, entry.attempts));
        await this.prisma.$executeRaw(Prisma.sql`
          UPDATE "AnalyticsDelivery"
          SET "status" = ${dead ? 'DEAD' : 'FAILED'}, "nextAttemptAt" = NOW() + (${delaySeconds} * INTERVAL '1 second'),
              "lockedAt" = NULL, "lastError" = ${message}, "updatedAt" = NOW()
          WHERE "id" = ${entry.id}::uuid
        `);
      }
    }
    return claimed.length;
  }

  private async claim(provider: string): Promise<ClaimedAnalyticsDelivery[]> {
    const rows = await this.prisma.$transaction(async (tx) => tx.$queryRaw<RawDelivery[]>(Prisma.sql`
      WITH candidates AS (
        SELECT delivery."id"
        FROM "AnalyticsDelivery" delivery
        WHERE delivery."provider" = ${provider}
          AND ((delivery."status" IN ('PENDING', 'FAILED') AND delivery."nextAttemptAt" <= NOW())
            OR (delivery."status" = 'PROCESSING' AND delivery."lockedAt" < NOW() - INTERVAL '5 minutes'))
        ORDER BY delivery."createdAt", delivery."id"
        FOR UPDATE SKIP LOCKED
        LIMIT ${this.config.values.ANALYTICS_DISPATCH_BATCH_SIZE}
      ), claimed AS (
        UPDATE "AnalyticsDelivery" delivery
        SET "status" = 'PROCESSING', "attempts" = delivery."attempts" + 1,
            "lockedAt" = NOW(), "updatedAt" = NOW()
        FROM candidates
        WHERE delivery."id" = candidates."id"
        RETURNING delivery.*
      )
      SELECT claimed."id", claimed."analyticsEventId", claimed."attempts",
        event."eventId", event."eventName", event."envelopeVersion", event."sourceType",
        event."sourceSchemaVersion", event."accountId", event."characterId", event."realmId",
        event."mapId", event."regionKey", event."sessionId", event."clientVersion",
        event."contentVersion", event."operationId", event."correlationId", event."occurredAt",
        event."ingestedAt", event."properties"
      FROM claimed JOIN "AnalyticsEvent" event ON event."id" = claimed."analyticsEventId"
      ORDER BY event."occurredAt", event."eventId"
    `));
    return rows.map((row) => ({
      id: row.id,
      analyticsEventId: row.analyticsEventId,
      attempts: row.attempts,
      envelope: {
        envelopeVersion: 1,
        eventId: row.eventId,
        eventName: row.eventName,
        sourceType: row.sourceType,
        sourceSchemaVersion: row.sourceSchemaVersion,
        serverTime: row.ingestedAt.toISOString(),
        occurredAt: row.occurredAt.toISOString(),
        ...(row.accountId ? { accountId: row.accountId } : {}),
        ...(row.characterId ? { characterId: row.characterId } : {}),
        ...(row.realmId ? { realmId: row.realmId } : {}),
        ...(row.mapId ? { mapId: row.mapId } : {}),
        ...(row.regionKey ? { regionKey: row.regionKey } : {}),
        ...(row.sessionId ? { sessionId: row.sessionId } : {}),
        ...(row.clientVersion ? { clientVersion: row.clientVersion } : {}),
        contentVersion: row.contentVersion,
        operationId: row.operationId,
        correlationId: row.correlationId,
        properties: row.properties as Record<string, unknown>,
      },
    }));
  }
}
