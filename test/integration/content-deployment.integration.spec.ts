import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import {
  deployCompiledContent,
  readActiveContentRelease,
  rollbackContent,
} from '../../src/content/content-deployment.service.js';
import {
  compileCurrentContent,
  contentHash,
  type CompiledContentPackage,
} from '../../src/content/content-package.compiler.js';

const run = process.env.RUN_DB_TESTS === 'true';
const describeDb = run ? describe : describe.skip;

function version(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function withVersion(base: CompiledContentPackage, nextVersion: string): CompiledContentPackage {
  const manifest = structuredClone(base.manifest);
  manifest.version = nextVersion;
  return { manifest, sourceHash: contentHash(manifest) };
}

describeDb('content deployment integration', () => {
  let prisma: PrismaClient;
  let compiled: CompiledContentPackage;

  beforeAll(async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required for integration tests.');
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    compiled = await compileCurrentContent({ realmSlug: 'world-1', realmName: 'World 1' });
  });

  afterAll(async () => prisma?.$disconnect());

  it('is idempotent and does not mutate maps on the second deployment', async () => {
    const packageToDeploy = withVersion(compiled, version('repeat'));
    const first = await deployCompiledContent(prisma, packageToDeploy, {
      operationId: `test:${randomUUID()}`, author: 'integration', allowRisky: true,
    });
    const mapAfterFirst = await prisma.$queryRaw<Array<{ version: number }>>(Prisma.sql`
      SELECT "version" FROM "Map" WHERE "key" = 'greenfields' LIMIT 1
    `);
    const second = await deployCompiledContent(prisma, packageToDeploy, {
      operationId: `test:${randomUUID()}`, author: 'integration', allowRisky: true,
    });
    const mapAfterSecond = await prisma.$queryRaw<Array<{ version: number }>>(Prisma.sql`
      SELECT "version" FROM "Map" WHERE "key" = 'greenfields' LIMIT 1
    `);
    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(mapAfterSecond[0]?.version).toBe(mapAfterFirst[0]?.version);
  });

  it('serializes concurrent deployment of the same package', async () => {
    const packageToDeploy = withVersion(compiled, version('parallel'));
    const results = await Promise.all([
      deployCompiledContent(prisma, packageToDeploy, {
        operationId: `test:${randomUUID()}`, author: 'integration', allowRisky: true,
      }),
      deployCompiledContent(prisma, packageToDeploy, {
        operationId: `test:${randomUUID()}`, author: 'integration', allowRisky: true,
      }),
    ]);
    expect(results.filter((result) => result.idempotent)).toHaveLength(1);
    const releases = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS "count" FROM "ContentRelease"
      WHERE "version" = ${packageToDeploy.manifest.version}
    `);
    expect(Number(releases[0]?.count)).toBe(1);
  });

  it('rolls back every content mutation when deployment is interrupted', async () => {
    const activeBefore = await readActiveContentRelease(prisma);
    const mapBefore = await prisma.$queryRaw<Array<{ version: number }>>(Prisma.sql`
      SELECT "version" FROM "Map" WHERE "key" = 'greenfields' LIMIT 1
    `);
    const packageToDeploy = withVersion(compiled, version('interrupted'));
    const operationId = `test:${randomUUID()}`;
    await expect(deployCompiledContent(prisma, packageToDeploy, {
      operationId,
      author: 'integration',
      allowRisky: true,
      beforeActivate: async () => { throw new Error('simulated interruption'); },
    })).rejects.toThrow('simulated interruption');
    const activeAfter = await readActiveContentRelease(prisma);
    const mapAfter = await prisma.$queryRaw<Array<{ version: number }>>(Prisma.sql`
      SELECT "version" FROM "Map" WHERE "key" = 'greenfields' LIMIT 1
    `);
    const release = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS "count" FROM "ContentRelease"
      WHERE "version" = ${packageToDeploy.manifest.version}
    `);
    const attempt = await prisma.$queryRaw<Array<{ state: string }>>(Prisma.sql`
      SELECT "state" FROM "ContentDeploymentAttempt" WHERE "operationId" = ${operationId}
    `);
    expect(activeAfter?.version).toBe(activeBefore?.version);
    expect(mapAfter[0]?.version).toBe(mapBefore[0]?.version);
    expect(Number(release[0]?.count)).toBe(0);
    expect(attempt[0]?.state).toBe('FAILED');
  });

  it('keeps active quest and item instances and never replays rewards during rollback', async () => {
    const firstPackage = withVersion(compiled, version('rollback-a'));
    const secondPackage = withVersion(compiled, version('rollback-b'));
    await deployCompiledContent(prisma, firstPackage, {
      operationId: `test:${randomUUID()}`, author: 'integration', allowRisky: true,
    });

    const userId = randomUUID();
    const characterId = randomUUID();
    const characterQuestId = randomUUID();
    const inventoryId = randomUUID();
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "User" ("id", "firebaseUid", "createdAt", "updatedAt")
      VALUES (${userId}::uuid, ${`integration-${userId}`}, NOW(), NOW())
    `);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "Character" (
        "id", "userId", "realmId", "name", "class", "level", "experience", "outfitKey",
        "mapId", "x", "y", "direction", "combatState", "hp", "maxHp", "energy", "maxEnergy",
        "strength", "agility", "intelligence", "armor", "silver", "gold", "createdAt", "updatedAt"
      )
      SELECT ${characterId}::uuid, ${userId}::uuid, realm."id", ${`I${characterId.slice(0, 10)}`},
        'WARRIOR'::"CharacterClass", 1, 0, 'warrior', map."id", 4, 4,
        'SOUTH'::"Direction", 'IDLE'::"CombatState", 100, 100, 50, 50, 10, 10, 10, 5, 0, 0, NOW(), NOW()
      FROM "Realm" realm JOIN "Map" map ON map."realmId" = realm."id"
      WHERE realm."slug" = 'world-1' AND map."key" = 'greenfields' LIMIT 1
    `);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "CharacterQuest" (
        "id", "characterId", "questDefinitionId", "status", "progress", "startedAt", "createdAt", "updatedAt"
      ) SELECT ${characterQuestId}::uuid, ${characterId}::uuid, "id", 'ACTIVE'::"QuestProgressStatus",
        ${JSON.stringify({ stage: 0, counters: {}, __contentSnapshot: { instanceType: 'QUEST', contentVersion: firstPackage.manifest.version, definitionKey: 'rabbit-fur-for-mira', definition: { key: 'rabbit-fur-for-mira' } } })}::jsonb,
        NOW(), NOW(), NOW() FROM "QuestDefinition" WHERE "key" = 'rabbit-fur-for-mira'
    `);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "InventoryItem" (
        "id", "characterId", "itemDefinitionId", "quantity", "slotIndex", "instanceData", "createdAt", "updatedAt"
      ) SELECT ${inventoryId}::uuid, ${characterId}::uuid, "id", 1, 0,
        ${JSON.stringify({ __contentSnapshot: { instanceType: 'ITEM', contentVersion: firstPackage.manifest.version, definitionKey: 'rabbit-fur', definition: { key: 'rabbit-fur' } } })}::jsonb,
        NOW(), NOW() FROM "ItemDefinition" WHERE "key" = 'rabbit-fur'
    `);
    const questEvents = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS "count" FROM "DomainEvent"
      WHERE "type" = 'QuestChoiceMade' AND "actorCharacterId" = ${characterId}::uuid
    `);
    expect(Number(questEvents[0]?.count)).toBe(1);
    const ledgerBefore = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS "count" FROM "CharacterCurrencyLedger" WHERE "characterId" = ${characterId}::uuid
    `);

    await deployCompiledContent(prisma, secondPackage, {
      operationId: `test:${randomUUID()}`, author: 'integration', allowRisky: true,
    });
    await rollbackContent(prisma, firstPackage.manifest.version, {
      operationId: `test:${randomUUID()}`, author: 'integration', allowRisky: true,
    });

    const rows = await prisma.$queryRaw<Array<{ quests: bigint; items: bigint }>>(Prisma.sql`
      SELECT
        (SELECT COUNT(*) FROM "CharacterQuest" WHERE "id" = ${characterQuestId}::uuid)::bigint AS quests,
        (SELECT COUNT(*) FROM "InventoryItem" WHERE "id" = ${inventoryId}::uuid)::bigint AS items
    `);
    const ledgerAfter = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS "count" FROM "CharacterCurrencyLedger" WHERE "characterId" = ${characterId}::uuid
    `);
    expect(Number(rows[0]?.quests)).toBe(1);
    expect(Number(rows[0]?.items)).toBe(1);
    expect(Number(ledgerAfter[0]?.count)).toBe(Number(ledgerBefore[0]?.count));
    await prisma.$executeRaw(Prisma.sql`DELETE FROM "User" WHERE "id" = ${userId}::uuid`);
  });
});
