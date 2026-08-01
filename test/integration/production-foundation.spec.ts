import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import type { PrismaService } from '../../src/database/prisma.service.js';
import { compileContentManifest } from '../../src/foundation/content/content.compiler.js';
import {
  deployContentPackage,
  readActiveContentManifest,
} from '../../src/foundation/content/content.deployer.js';
import { InboxService } from '../../src/foundation/events/inbox.service.js';
import { economyReport } from '../../src/foundation/reporting/production-reports.js';
import { buildGameContentManifest } from '../../prisma/content.js';

const enabled = process.env.RUN_POSTGRES_TESTS === '1';
const integration = enabled ? describe : describe.skip;
const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://game:game@localhost:5432/grid_mmorpg?schema=public';

integration('production foundation PostgreSQL integration', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const suffix = randomUUID().slice(0, 8);
  let userId = '';
  let characterId = '';
  let mapId = '';
  let realmId = '';
  let eventId = '';

  beforeAll(async () => {
    const realm = await prisma.realm.findUnique({ where: { slug: 'world-1' } });
    if (!realm) throw new Error('Integration test requires seeded world-1 realm.');
    const map = await prisma.map.findUnique({
      where: { realmId_key: { realmId: realm.id, key: 'greenfields' } },
    });
    if (!map) throw new Error('Integration test requires seeded Greenfields map.');
    realmId = realm.id;
    mapId = map.id;
    const user = await prisma.user.create({
      data: { firebaseUid: `foundation-test-${suffix}`, displayName: 'Foundation Test' },
    });
    userId = user.id;
    const character = await prisma.character.create({
      data: {
        userId,
        realmId,
        mapId,
        name: `F${suffix}`,
        class: 'WARRIOR',
        gender: 'MALE',
        outfitKey: 'test-warrior',
        x: map.spawnX,
        y: map.spawnY,
        hp: 100,
        maxHp: 100,
        energy: 100,
        maxEnergy: 100,
        strength: 10,
        agility: 10,
        intelligence: 10,
        armor: 10,
      },
    });
    characterId = character.id;
    await prisma.$executeRaw(Prisma.sql`
      CREATE TABLE IF NOT EXISTS "FoundationTestEffect" (
        "consumer" VARCHAR(160) NOT NULL,
        "eventId" UUID NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "FoundationTestEffect_pkey" PRIMARY KEY ("consumer", "eventId")
      )
    `);
  });

  afterAll(async () => {
    if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
    await prisma.$executeRaw(Prisma.sql`DROP TABLE IF EXISTS "FoundationTestEffect"`);
    await prisma.$disconnect();
  });

  it('replays the same content hash without creating another release', async () => {
    const beforeRows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count FROM "ContentRelease"
    `);
    const manifest = await buildGameContentManifest();
    const active = await readActiveContentManifest(prisma);
    const compiled = compileContentManifest(manifest, active);
    const first = await deployContentPackage(prisma, compiled, {
      realmSlug: 'world-1',
      realmName: 'World 1',
    });
    const second = await deployContentPackage(prisma, compiled, {
      realmSlug: 'world-1',
      realmName: 'World 1',
    });
    const afterRows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count FROM "ContentRelease"
    `);
    expect(first.replayed).toBe(true);
    expect(second.replayed).toBe(true);
    expect(afterRows[0]!.count).toBe(beforeRows[0]!.count);
  });

  it('blocks an invalid package before any persistent change', async () => {
    const active = await readActiveContentManifest(prisma);
    if (!active) throw new Error('Active manifest missing.');
    const invalid = {
      ...active,
      mobs: active.mobs.map((mob, index) =>
        index === 0 ? { ...mob, lootTableKey: 'missing-loot' } : mob,
      ),
    };
    const beforeRows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count FROM "ContentRelease"
    `);
    expect(() => compileContentManifest(invalid)).toThrow(/missing loot table/);
    const afterRows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count FROM "ContentRelease"
    `);
    expect(afterRows[0]!.count).toBe(beforeRows[0]!.count);
  });

  it('writes currency mutation and sanitized event atomically', async () => {
    const operationId = `foundation-credit-${suffix}`;
    await prisma.$transaction(async (transaction) => {
      const updated = await transaction.character.update({
        where: { id: characterId },
        data: { silver: { increment: 125 } },
        select: { silver: true },
      });
      await transaction.characterCurrencyLedger.create({
        data: {
          characterId,
          operationId,
          currency: 'SILVER',
          direction: 'CREDIT',
          amount: 125,
          reason: 'FOUNDATION_TEST',
          balanceAfter: updated.silver,
          metadata: { nested: { token: 'secret', safe: 7 } },
        },
      });
    });
    const rows = await prisma.$queryRaw<Array<{ id: string; payload: unknown; outboxCount: bigint }>>(Prisma.sql`
      SELECT event."id", event."payload", COUNT(outbox."id")::bigint AS "outboxCount"
      FROM "DomainEvent" event
      LEFT JOIN "DomainOutbox" outbox ON outbox."eventId" = event."id"
      WHERE event."operationId" = ${operationId}
      GROUP BY event."id", event."payload"
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outboxCount).toBe(1n);
    expect(rows[0]!.payload).toMatchObject({
      amount: 125,
      metadata: { nested: { token: '[REDACTED]', safe: 7 } },
    });
  });

  it('rolls back both mutation and event when the transaction fails', async () => {
    const operationId = `foundation-rollback-${suffix}`;
    await expect(
      prisma.$transaction(async (transaction) => {
        await transaction.character.update({
          where: { id: characterId },
          data: { silver: { increment: 9 } },
        });
        await transaction.characterCurrencyLedger.create({
          data: {
            characterId,
            operationId,
            currency: 'SILVER',
            direction: 'CREDIT',
            amount: 9,
            reason: 'FOUNDATION_ROLLBACK_TEST',
            balanceAfter: 0,
          },
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    const eventRows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count FROM "DomainEvent" WHERE "operationId" = ${operationId}
    `);
    const ledgerRows = await prisma.characterCurrencyLedger.count({
      where: { characterId, operationId },
    });
    expect(eventRows[0]!.count).toBe(0n);
    expect(ledgerRows).toBe(0);
  });

  it('snapshots item and quest definition content hashes', async () => {
    const [item, quest] = await Promise.all([
      prisma.itemDefinition.findUniqueOrThrow({ where: { key: 'minor-health-potion' } }),
      prisma.questDefinition.findUniqueOrThrow({ where: { key: 'rabbit-fur-for-mira' } }),
    ]);
    const inventory = await prisma.inventoryItem.create({
      data: { characterId, itemDefinitionId: item.id, quantity: 1, slotIndex: 0 },
    });
    const characterQuest = await prisma.characterQuest.create({
      data: { characterId, questDefinitionId: quest.id, status: 'ACTIVE' },
    });
    const rows = await prisma.$queryRaw<
      Array<{ itemHash: string | null; questHash: string | null; activeHash: string | null }>
    >(Prisma.sql`
      SELECT
        inventory."definitionContentHash" AS "itemHash",
        progress."definitionContentHash" AS "questHash",
        foundation_active_content_hash() AS "activeHash"
      FROM "InventoryItem" inventory
      JOIN "CharacterQuest" progress ON progress."id" = ${characterQuest.id}::uuid
      WHERE inventory."id" = ${inventory.id}::uuid
    `);
    expect(rows[0]!.itemHash).toBe(rows[0]!.activeHash);
    expect(rows[0]!.questHash).toBe(rows[0]!.activeHash);
  });

  it('applies five inbox replays exactly once', async () => {
    const emitted = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT foundation_emit_domain_event(
        'foundation.test.effect', 1, ${realmId}::uuid, ${mapId}::uuid,
        ${characterId}::uuid, ${userId}::uuid, ${`effect-${suffix}`}, NULL,
        '{"safe":true}'::jsonb
      ) AS id
    `);
    eventId = emitted[0]!.id;
    const inbox = new InboxService(prisma as unknown as PrismaService);
    const results = [];
    for (let index = 0; index < 5; index += 1) {
      results.push(
        await inbox.consume('foundation-test-consumer', eventId, async (transaction, event) => {
          await transaction.$executeRaw(Prisma.sql`
            INSERT INTO "FoundationTestEffect" ("consumer", "eventId")
            VALUES ('foundation-test-consumer', ${event.id}::uuid)
          `);
          return { applied: true };
        }),
      );
    }
    const effects = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM "FoundationTestEffect"
      WHERE "consumer" = 'foundation-test-consumer' AND "eventId" = ${eventId}::uuid
    `);
    expect(results.filter((result) => result.processed)).toHaveLength(1);
    expect(effects[0]!.count).toBe(1n);
  });

  it('reconciles the currency ledger with emitted economy events', async () => {
    const reconciliation = await economyReport(prisma);
    expect(reconciliation.reconciliation).not.toEqual([]);
    expect(reconciliation.reconciliation).toEqual(
      expect.arrayContaining([expect.objectContaining({ currency: 'SILVER', reconciled: true })]),
    );
  });
});
