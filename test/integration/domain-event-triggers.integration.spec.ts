import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';

const run = process.env.RUN_DB_TESTS === 'true';
const describeDb = run ? describe : describe.skip;

describeDb('database domain-event triggers', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required for integration tests.');
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  });

  afterAll(async () => prisma?.$disconnect());

  it('publishes TradeCompleted atomically with the completed trade row', async () => {
    const firstUserId = randomUUID();
    const secondUserId = randomUUID();
    const firstCharacterId = randomUUID();
    const secondCharacterId = randomUUID();
    const tradeId = randomUUID();

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "User" ("id", "firebaseUid", "createdAt", "updatedAt") VALUES
          (${firstUserId}::uuid, ${`trade-a-${firstUserId}`}, NOW(), NOW()),
          (${secondUserId}::uuid, ${`trade-b-${secondUserId}`}, NOW(), NOW())
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "Character" (
          "id", "userId", "realmId", "name", "class", "level", "experience", "outfitKey",
          "mapId", "x", "y", "direction", "combatState", "hp", "maxHp", "energy", "maxEnergy",
          "strength", "agility", "intelligence", "armor", "silver", "gold", "createdAt", "updatedAt"
        )
        SELECT ${firstCharacterId}::uuid, ${firstUserId}::uuid, realm."id", ${`A${firstCharacterId.slice(0, 10)}`},
          'WARRIOR'::"CharacterClass", 1, 0, 'warrior', map."id", 4, 4,
          'SOUTH'::"Direction", 'IDLE'::"CombatState", 100, 100, 50, 50, 10, 10, 10, 5, 100, 0, NOW(), NOW()
        FROM "Realm" realm JOIN "Map" map ON map."realmId" = realm."id"
        WHERE realm."slug" = 'world-1' AND map."key" = 'greenfields' LIMIT 1
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "Character" (
          "id", "userId", "realmId", "name", "class", "level", "experience", "outfitKey",
          "mapId", "x", "y", "direction", "combatState", "hp", "maxHp", "energy", "maxEnergy",
          "strength", "agility", "intelligence", "armor", "silver", "gold", "createdAt", "updatedAt"
        )
        SELECT ${secondCharacterId}::uuid, ${secondUserId}::uuid, realm."id", ${`B${secondCharacterId.slice(0, 10)}`},
          'WARRIOR'::"CharacterClass", 1, 0, 'warrior', map."id", 5, 4,
          'SOUTH'::"Direction", 'IDLE'::"CombatState", 100, 100, 50, 50, 10, 10, 10, 5, 100, 0, NOW(), NOW()
        FROM "Realm" realm JOIN "Map" map ON map."realmId" = realm."id"
        WHERE realm."slug" = 'world-1' AND map."key" = 'greenfields' LIMIT 1
      `);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "TradeSession" (
          "id", "initiatorCharacterId", "recipientCharacterId", "status",
          "initiatorAccepted", "recipientAccepted", "initiatorSilver", "recipientSilver",
          "expiresAt", "createdAt", "updatedAt"
        ) VALUES (
          ${tradeId}::uuid, ${firstCharacterId}::uuid, ${secondCharacterId}::uuid,
          'OPEN'::"TradeStatus", TRUE, TRUE, 25, 5, NOW() + INTERVAL '10 minutes', NOW(), NOW()
        )
      `);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "Character" SET "silver" = 80 WHERE "id" = ${firstCharacterId}::uuid
      `);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "Character" SET "silver" = 120 WHERE "id" = ${secondCharacterId}::uuid
      `);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "TradeSession" SET "status" = 'COMPLETED'::"TradeStatus", "updatedAt" = NOW()
        WHERE "id" = ${tradeId}::uuid
      `);
    });

    const rows = await prisma.$queryRaw<Array<{ events: bigint; outbox: bigint }>>(Prisma.sql`
      SELECT
        (SELECT COUNT(*) FROM "DomainEvent" WHERE "type" = 'TradeCompleted' AND "operationId" = ${`trade:${tradeId}`})::bigint AS events,
        (SELECT COUNT(*) FROM "EventOutbox" outbox JOIN "DomainEvent" event ON event."id" = outbox."eventId"
          WHERE event."type" = 'TradeCompleted' AND event."operationId" = ${`trade:${tradeId}`})::bigint AS outbox
    `);
    expect(Number(rows[0]?.events)).toBe(1);
    expect(Number(rows[0]?.outbox)).toBe(1);

    await prisma.$executeRaw(Prisma.sql`
      DELETE FROM "User" WHERE "id" IN (${firstUserId}::uuid, ${secondUserId}::uuid)
    `);
  });
});
