import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import { DomainEventService, appendDomainEvent, requeueDomainEvents } from '../../src/domain-events/domain-event.service.js';
import { OutboxDispatcherService } from '../../src/domain-events/outbox-dispatcher.service.js';

const run = process.env.RUN_DB_TESTS === 'true';
const describeDb = run ? describe : describe.skip;

function config() {
  return {
    values: {
      OUTBOX_ENABLED: true,
      OUTBOX_POLL_INTERVAL_MS: 10_000,
      OUTBOX_BATCH_SIZE: 20,
      OUTBOX_MAX_ATTEMPTS: 3,
    },
  };
}

describeDb('domain event integration', () => {
  let prisma: PrismaClient;
  let service: DomainEventService;

  beforeAll(() => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required for integration tests.');
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    service = new DomainEventService(prisma as never);
  });

  afterAll(async () => prisma?.$disconnect());

  it('rolls the event and outbox back with the domain transaction', async () => {
    const operationId = `atomic:${randomUUID()}`;
    await expect(prisma.$transaction(async (tx) => {
      await appendDomainEvent(tx, {
        operationId,
        type: 'RegionContributionAdded',
        regionKey: 'greenfields',
        payload: {
          regionKey: 'greenfields', contributionKind: 'TEST',
          contributions: [{ subjectType: 'REALM', subjectId: 'world-1', kind: 'TEST', amount: 1 }],
        },
      });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS "count" FROM "DomainEvent" WHERE "operationId" = ${operationId}
    `);
    expect(Number(rows[0]?.count)).toBe(0);
  });

  it('survives a dispatcher restart and materializes effects exactly once across replay', async () => {
    const operationId = `restart:${randomUUID()}`;
    const appended = await service.appendInTransaction({
      operationId,
      type: 'RegionContributionAdded',
      regionKey: 'greenfields',
      payload: {
        regionKey: 'greenfields', contributionKind: 'WARD',
        contributions: [{
          subjectType: 'REALM', subjectId: 'world-1', kind: 'WARD', amount: 3,
          metadata: { eligible: true },
        }],
      },
    });
    const firstDispatcher = new OutboxDispatcherService(prisma as never, service, config() as never);
    await firstDispatcher.dispatchNow();
    for (let index = 0; index < 5; index += 1) {
      await requeueDomainEvents(prisma, { type: 'RegionContributionAdded' });
      const restarted = new OutboxDispatcherService(prisma as never, service, config() as never);
      await restarted.dispatchNow();
    }
    const rows = await prisma.$queryRaw<Array<{ contributions: bigint; audit: bigint; inbox: bigint }>>(Prisma.sql`
      SELECT
        (SELECT COUNT(*) FROM "ContributionLedger" WHERE "eventId" = ${appended.event.id}::uuid)::bigint AS contributions,
        (SELECT COUNT(*) FROM "RewardAuditLedger" WHERE "eventId" = ${appended.event.id}::uuid)::bigint AS audit,
        (SELECT COUNT(*) FROM "EventInbox" WHERE "eventId" = ${appended.event.id}::uuid AND "consumer" = 'core-ledgers-v1')::bigint AS inbox
    `);
    expect(Number(rows[0]?.contributions)).toBe(1);
    expect(Number(rows[0]?.audit)).toBe(1);
    expect(Number(rows[0]?.inbox)).toBe(1);
  });

  it('retries a failed consumer and keeps the event available', async () => {
    const operationId = `retry:${randomUUID()}`;
    const appended = await service.appendInTransaction({
      operationId,
      type: 'RegionContributionAdded',
      regionKey: 'greenfields',
      payload: {
        regionKey: 'greenfields', contributionKind: 'BROKEN',
        audit: [{ resourceType: 'XP', amount: 1, reason: 'TEST' }],
      },
    });
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "DomainEvent" SET "payload" = ${JSON.stringify({
        regionKey: 'greenfields', contributionKind: 'BROKEN',
        audit: [{ resourceType: 'XP', amount: 0, reason: 'TEST' }],
      })}::jsonb WHERE "id" = ${appended.event.id}::uuid
    `);
    const failing = new OutboxDispatcherService(prisma as never, service, config() as never);
    await failing.dispatchNow();
    const failed = await prisma.$queryRaw<Array<{ status: string; attempts: number }>>(Prisma.sql`
      SELECT "status", "attempts" FROM "EventOutbox" WHERE "eventId" = ${appended.event.id}::uuid
    `);
    expect(failed[0]?.status).toBe('FAILED');
    expect(failed[0]?.attempts).toBe(1);

    await prisma.$executeRaw(Prisma.sql`
      UPDATE "DomainEvent" SET "payload" = ${JSON.stringify({
        regionKey: 'greenfields', contributionKind: 'FIXED',
        audit: [{ resourceType: 'XP', amount: 5, reason: 'TEST' }],
      })}::jsonb WHERE "id" = ${appended.event.id}::uuid
    `);
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "EventOutbox" SET "nextAttemptAt" = NOW() WHERE "eventId" = ${appended.event.id}::uuid
    `);
    const restarted = new OutboxDispatcherService(prisma as never, service, config() as never);
    await restarted.dispatchNow();
    const succeeded = await prisma.$queryRaw<Array<{ status: string; attempts: number }>>(Prisma.sql`
      SELECT "status", "attempts" FROM "EventOutbox" WHERE "eventId" = ${appended.event.id}::uuid
    `);
    expect(succeeded[0]?.status).toBe('PUBLISHED');
    expect(succeeded[0]?.attempts).toBe(2);
  });
});
