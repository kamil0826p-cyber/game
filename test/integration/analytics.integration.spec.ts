import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AnalyticsDispatcherService } from '../../src/analytics/analytics-dispatcher.service.js';
import { AnalyticsIngestionService } from '../../src/analytics/analytics-ingestion.service.js';
import { DomainEventService, appendDomainEvent } from '../../src/domain-events/domain-event.service.js';
import { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';

const run = process.env.RUN_DB_TESTS === 'true';
const describeDb = run ? describe : describe.skip;

function config(overrides: Record<string, unknown> = {}) {
  return {
    values: {
      ANALYTICS_ENABLED: true,
      ANALYTICS_INGEST_INTERVAL_MS: 10_000,
      ANALYTICS_INGEST_BATCH_SIZE: 100,
      ANALYTICS_DISPATCH_INTERVAL_MS: 10_000,
      ANALYTICS_DISPATCH_BATCH_SIZE: 100,
      ANALYTICS_QUEUE_CAPACITY: 1000,
      ANALYTICS_MAX_ATTEMPTS: 3,
      ANALYTICS_RETENTION_DAYS: 180,
      ANALYTICS_SAMPLE_BASIS_POINTS: 10_000,
      GAME_CONTENT_VERSION: 'integration-content',
      ...overrides,
    },
  };
}

function disabledProvider() {
  return { active: undefined };
}

describeDb('analytics integration', () => {
  let prisma: PrismaClient;
  let events: DomainEventService;

  beforeAll(() => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required for analytics integration tests.');
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    events = new DomainEventService(prisma as never);
  });

  afterAll(async () => prisma?.$disconnect());

  it('survives an ingestion restart and stores an event exactly once', async () => {
    const operationId = `analytics-restart:${randomUUID()}`;
    const appended = await events.appendInTransaction({
      operationId,
      type: 'SessionStarted',
      payload: { accountId: randomUUID(), sessionId: `session-${randomUUID()}` },
    });
    const first = new AnalyticsIngestionService(prisma as never, events, config() as never, disabledProvider() as never);
    await first.ingestNow();
    const restarted = new AnalyticsIngestionService(prisma as never, events, config() as never, disabledProvider() as never);
    await restarted.ingestNow();
    const rows = await prisma.$queryRaw<Array<{ events: bigint; receipts: bigint }>>(Prisma.sql`
      SELECT
        (SELECT COUNT(*) FROM "AnalyticsEvent" WHERE "eventId" = ${appended.event.id}::uuid)::bigint AS events,
        (SELECT COUNT(*) FROM "EventInbox" WHERE "eventId" = ${appended.event.id}::uuid AND "consumer" = 'analytics-ingestion-v1')::bigint AS receipts
    `);
    expect(Number(rows[0]?.events)).toBe(1);
    expect(Number(rows[0]?.receipts)).toBe(1);
  });

  it('does not ingest a domain mutation rolled back before commit', async () => {
    const operationId = `analytics-rollback:${randomUUID()}`;
    await expect(prisma.$transaction(async (tx) => {
      await appendDomainEvent(tx, {
        operationId,
        type: 'SessionStarted',
        payload: { accountId: randomUUID(), sessionId: `session-${randomUUID()}` },
      });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    const ingestion = new AnalyticsIngestionService(prisma as never, events, config() as never, disabledProvider() as never);
    await ingestion.ingestNow();
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count FROM "AnalyticsEvent" WHERE "operationId" = ${operationId}
    `);
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it('stops ingestion at the bounded provider queue capacity without blocking domain commits', async () => {
    const provider = { active: { kind: 'http', send: async () => undefined } };
    const existingEvent = await events.appendInTransaction({
      operationId: `queue-existing:${randomUUID()}`,
      type: 'SessionStarted',
      payload: { accountId: randomUUID(), sessionId: `session-${randomUUID()}` },
    });
    const initial = new AnalyticsIngestionService(prisma as never, events, config() as never, provider as never);
    await initial.ingestNow();
    const blocked = await events.appendInTransaction({
      operationId: `queue-blocked:${randomUUID()}`,
      type: 'SessionStarted',
      payload: { accountId: randomUUID(), sessionId: `session-${randomUUID()}` },
    });
    const capped = new AnalyticsIngestionService(prisma as never, events, config({ ANALYTICS_QUEUE_CAPACITY: 1 }) as never, provider as never);
    expect(await capped.ingestNow()).toBe(0);
    const rows = await prisma.$queryRaw<Array<{ domainEvents: bigint; analyticsEvents: bigint }>>(Prisma.sql`
      SELECT
        (SELECT COUNT(*) FROM "DomainEvent" WHERE "id" IN (${existingEvent.event.id}::uuid, ${blocked.event.id}::uuid))::bigint AS "domainEvents",
        (SELECT COUNT(*) FROM "AnalyticsEvent" WHERE "eventId" = ${blocked.event.id}::uuid)::bigint AS "analyticsEvents"
    `);
    expect(Number(rows[0]?.domainEvents)).toBe(2);
    expect(Number(rows[0]?.analyticsEvents)).toBe(0);
  });

  it('retries provider failure and succeeds after restart', async () => {
    const appended = await events.appendInTransaction({
      operationId: `delivery-retry:${randomUUID()}`,
      type: 'SessionStarted',
      payload: { accountId: randomUUID(), sessionId: `session-${randomUUID()}` },
    });
    const activeProvider = { active: { kind: 'http', send: async () => { throw new Error('provider unavailable'); } } };
    const ingestion = new AnalyticsIngestionService(prisma as never, events, config() as never, activeProvider as never);
    await ingestion.ingestNow();
    const failing = new AnalyticsDispatcherService(prisma as never, config() as never, activeProvider as never);
    await failing.dispatchNow();
    const failed = await prisma.$queryRaw<Array<{ status: string; attempts: number }>>(Prisma.sql`
      SELECT delivery."status", delivery."attempts"
      FROM "AnalyticsDelivery" delivery JOIN "AnalyticsEvent" event ON event."id" = delivery."analyticsEventId"
      WHERE event."eventId" = ${appended.event.id}::uuid
    `);
    expect(failed[0]).toMatchObject({ status: 'FAILED', attempts: 1 });
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "AnalyticsDelivery" delivery SET "nextAttemptAt" = NOW()
      FROM "AnalyticsEvent" event
      WHERE event."id" = delivery."analyticsEventId" AND event."eventId" = ${appended.event.id}::uuid
    `);
    const successProvider = { active: { kind: 'http', send: async () => undefined } };
    const restarted = new AnalyticsDispatcherService(prisma as never, config() as never, successProvider as never);
    await restarted.dispatchNow();
    const sent = await prisma.$queryRaw<Array<{ status: string; attempts: number }>>(Prisma.sql`
      SELECT delivery."status", delivery."attempts"
      FROM "AnalyticsDelivery" delivery JOIN "AnalyticsEvent" event ON event."id" = delivery."analyticsEventId"
      WHERE event."eventId" = ${appended.event.id}::uuid
    `);
    expect(sent[0]).toMatchObject({ status: 'SENT', attempts: 2 });
  });

  it('reconciles currency telemetry to the authoritative ledger', async () => {
    const userId = randomUUID();
    const characterId = randomUUID();
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "User" ("id", "firebaseUid", "createdAt", "updatedAt")
      VALUES (${userId}::uuid, ${`analytics-${userId}`}, NOW(), NOW())
    `);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "Character" (
        "id", "userId", "realmId", "name", "class", "level", "experience", "outfitKey",
        "mapId", "x", "y", "direction", "combatState", "hp", "maxHp", "energy", "maxEnergy",
        "strength", "agility", "intelligence", "armor", "silver", "gold", "createdAt", "updatedAt"
      )
      SELECT ${characterId}::uuid, ${userId}::uuid, realm."id", ${`T${characterId.slice(0, 10)}`},
        'WARRIOR'::"CharacterClass", 1, 0, 'warrior', map."id", 4, 4,
        'SOUTH'::"Direction", 'IDLE'::"CombatState", 100, 100, 50, 50, 10, 10, 10, 5, 17, 0, NOW(), NOW()
      FROM "Realm" realm JOIN "Map" map ON map."realmId" = realm."id"
      WHERE realm."slug" = 'world-1' AND map."key" = 'greenfields' LIMIT 1
    `);
    const operationId = `analytics-currency:${randomUUID()}`;
    await prisma.characterCurrencyLedger.create({
      data: {
        characterId,
        operationId,
        currency: 'SILVER',
        direction: 'CREDIT',
        amount: 17,
        reason: 'ANALYTICS_INTEGRATION_TEST',
        balanceAfter: 17,
        metadata: {},
      },
    });
    const ingestion = new AnalyticsIngestionService(prisma as never, events, config({ ANALYTICS_INGEST_BATCH_SIZE: 1000 }) as never, disabledProvider() as never);
    for (let index = 0; index < 10; index += 1) {
      if (await ingestion.ingestNow() === 0) break;
    }
    const rows = await prisma.$queryRaw<Array<{ gap: bigint }>>(Prisma.sql`
      SELECT gap FROM "AnalyticsEconomyDaily"
      WHERE day = CURRENT_DATE AND currency = 'SILVER'
    `);
    expect(rows.every((row) => Number(row.gap) === 0)).toBe(true);
    await prisma.$executeRaw(Prisma.sql`DELETE FROM "User" WHERE "id" = ${userId}::uuid`);
  });
});
