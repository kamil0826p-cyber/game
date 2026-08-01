import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';

function connectionString(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('DATABASE_URL is required.');
  return value;
}

async function status(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{
    total: bigint;
    migrated: bigint;
    backups: bigint;
    audits: bigint;
  }>>(Prisma.sql`
    SELECT
      (SELECT COUNT(*) FROM "Character")::bigint AS "total",
      (SELECT COUNT(*) FROM "Character" WHERE "progressionVersion" = 2)::bigint AS "migrated",
      (SELECT COUNT(*) FROM "CharacterProgressionMigrationBackup")::bigint AS "backups",
      (SELECT COUNT(*) FROM "CharacterProgressionAudit")::bigint AS "audits"
  `);
  process.stdout.write(`${JSON.stringify(rows[0], (_, value) => typeof value === 'bigint' ? Number(value) : value, 2)}\n`);
}

async function migrate(prisma: PrismaClient, dryRun: boolean): Promise<void> {
  const candidates = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS "count" FROM "Character" WHERE "progressionVersion" < 2
  `);
  const count = Number(candidates[0]?.count ?? 0);
  if (dryRun || count === 0) {
    console.log(`${dryRun ? 'Would migrate' : 'Migrated'} ${count} character(s).`);
    return;
  }
  const operationId = `migration:v2:cli:${Date.now()}`;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('progression-migration-v2'))`);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "CharacterProgressionMigrationBackup" (
        "characterId", "migrationVersion", "level", "hp", "maxHp", "energy", "maxEnergy",
        "strength", "agility", "intelligence", "armor", "stateVersion"
      )
      SELECT "id", 2, "level", "hp", "maxHp", "energy", "maxEnergy",
        "strength", "agility", "intelligence", "armor", "stateVersion"
      FROM "Character" WHERE "progressionVersion" < 2
      ON CONFLICT ("characterId") DO NOTHING
    `);
    await tx.$executeRaw(Prisma.sql`
      WITH equipment AS (
        SELECT
          item."characterId",
          SUM(CASE WHEN jsonb_typeof(source.bonuses -> 'maxHp') = 'number' THEN (source.bonuses ->> 'maxHp')::INTEGER ELSE 0 END)::INTEGER AS "maxHp",
          SUM(CASE WHEN jsonb_typeof(source.bonuses -> 'maxEnergy') = 'number' THEN (source.bonuses ->> 'maxEnergy')::INTEGER ELSE 0 END)::INTEGER AS "maxEnergy",
          SUM(CASE WHEN jsonb_typeof(source.bonuses -> 'strength') = 'number' THEN (source.bonuses ->> 'strength')::INTEGER ELSE 0 END)::INTEGER AS "strength",
          SUM(CASE WHEN jsonb_typeof(source.bonuses -> 'agility') = 'number' THEN (source.bonuses ->> 'agility')::INTEGER ELSE 0 END)::INTEGER AS "agility",
          SUM(CASE WHEN jsonb_typeof(source.bonuses -> 'intelligence') = 'number' THEN (source.bonuses ->> 'intelligence')::INTEGER ELSE 0 END)::INTEGER AS "intelligence",
          SUM(CASE WHEN jsonb_typeof(source.bonuses -> 'armor') = 'number' THEN (source.bonuses ->> 'armor')::INTEGER ELSE 0 END)::INTEGER AS "armor"
        FROM "InventoryItem" item
        JOIN "ItemDefinition" definition ON definition."id" = item."itemDefinitionId"
        CROSS JOIN LATERAL (
          SELECT COALESCE(
            item."instanceData" #> '{__contentSnapshot,definition,metadata,statBonuses}',
            definition."metadata" -> 'statBonuses',
            '{}'::jsonb
          ) AS bonuses
        ) source
        WHERE item."equippedSlot" IS NOT NULL
        GROUP BY item."characterId"
      )
      UPDATE "Character" character
      SET
        "legacyStatAdjustment" = jsonb_build_object(
          'maxHp', character."maxHp" - "canonical_base_stat"(character."class", 'maxHp') - "canonical_progression_stat"(character."class", character."level", 'maxHp') - COALESCE(equipment."maxHp", 0),
          'maxEnergy', character."maxEnergy" - "canonical_base_stat"(character."class", 'maxEnergy') - "canonical_progression_stat"(character."class", character."level", 'maxEnergy') - COALESCE(equipment."maxEnergy", 0),
          'strength', character."strength" - "canonical_base_stat"(character."class", 'strength') - "canonical_progression_stat"(character."class", character."level", 'strength') - COALESCE(equipment."strength", 0),
          'agility', character."agility" - "canonical_base_stat"(character."class", 'agility') - "canonical_progression_stat"(character."class", character."level", 'agility') - COALESCE(equipment."agility", 0),
          'intelligence', character."intelligence" - "canonical_base_stat"(character."class", 'intelligence') - "canonical_progression_stat"(character."class", character."level", 'intelligence') - COALESCE(equipment."intelligence", 0),
          'armor', character."armor" - "canonical_base_stat"(character."class", 'armor') - "canonical_progression_stat"(character."class", character."level", 'armor') - COALESCE(equipment."armor", 0)
        ),
        "progressionVersion" = 2,
        "statRevision" = "statRevision" + 1,
        "stateVersion" = "stateVersion" + 1,
        "updatedAt" = NOW()
      FROM equipment
      WHERE character."id" = equipment."characterId" AND character."progressionVersion" < 2
    `);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "Character" character
      SET
        "legacyStatAdjustment" = jsonb_build_object(
          'maxHp', character."maxHp" - "canonical_base_stat"(character."class", 'maxHp') - "canonical_progression_stat"(character."class", character."level", 'maxHp'),
          'maxEnergy', character."maxEnergy" - "canonical_base_stat"(character."class", 'maxEnergy') - "canonical_progression_stat"(character."class", character."level", 'maxEnergy'),
          'strength', character."strength" - "canonical_base_stat"(character."class", 'strength') - "canonical_progression_stat"(character."class", character."level", 'strength'),
          'agility', character."agility" - "canonical_base_stat"(character."class", 'agility') - "canonical_progression_stat"(character."class", character."level", 'agility'),
          'intelligence', character."intelligence" - "canonical_base_stat"(character."class", 'intelligence') - "canonical_progression_stat"(character."class", character."level", 'intelligence'),
          'armor', character."armor" - "canonical_base_stat"(character."class", 'armor') - "canonical_progression_stat"(character."class", character."level", 'armor')
        ),
        "progressionVersion" = 2,
        "statRevision" = "statRevision" + 1,
        "stateVersion" = "stateVersion" + 1,
        "updatedAt" = NOW()
      WHERE character."progressionVersion" < 2
        AND NOT EXISTS (
          SELECT 1 FROM "InventoryItem" item
          WHERE item."characterId" = character."id" AND item."equippedSlot" IS NOT NULL
        )
    `);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "CharacterProgressionAudit" (
        "id", "characterId", "operationId", "action", "progressionVersion",
        "beforeState", "afterState", "silverCost", "createdAt"
      )
      SELECT gen_random_uuid(), character."id", ${operationId}, 'MIGRATION', 2,
        to_jsonb(backup), jsonb_build_object(
          'progressionVersion', character."progressionVersion",
          'progressionChoices', character."progressionChoices",
          'legacyStatAdjustment', character."legacyStatAdjustment"
        ), 0, NOW()
      FROM "Character" character
      JOIN "CharacterProgressionMigrationBackup" backup ON backup."characterId" = character."id"
      ON CONFLICT ("characterId", "operationId") DO NOTHING
    `);
  });
  console.log(`Migrated ${count} character(s).`);
}

async function rollback(prisma: PrismaClient, dryRun: boolean): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS "count"
    FROM "CharacterProgressionMigrationBackup" backup
    JOIN "Character" character ON character."id" = backup."characterId"
    WHERE character."progressionVersion" = 2
  `);
  const count = Number(rows[0]?.count ?? 0);
  if (dryRun || count === 0) {
    console.log(`${dryRun ? 'Would roll back' : 'Rolled back'} ${count} character(s).`);
    return;
  }
  const operationId = `rollback:v2:${Date.now()}`;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('progression-migration-v2'))`);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "CharacterProgressionAudit" (
        "id", "characterId", "operationId", "action", "progressionVersion",
        "beforeState", "afterState", "silverCost", "createdAt"
      )
      SELECT ${randomUUID()}::uuid, character."id", ${operationId}, 'ROLLBACK', 2,
        jsonb_build_object(
          'progressionVersion', character."progressionVersion",
          'progressionChoices', character."progressionChoices",
          'legacyStatAdjustment', character."legacyStatAdjustment"
        ), to_jsonb(backup), 0, NOW()
      FROM "Character" character
      JOIN "CharacterProgressionMigrationBackup" backup ON backup."characterId" = character."id"
      LIMIT 1
      ON CONFLICT ("characterId", "operationId") DO NOTHING
    `);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "Character" character
      SET
        "hp" = LEAST(backup."hp", backup."maxHp"),
        "maxHp" = backup."maxHp",
        "energy" = LEAST(backup."energy", backup."maxEnergy"),
        "maxEnergy" = backup."maxEnergy",
        "strength" = backup."strength",
        "agility" = backup."agility",
        "intelligence" = backup."intelligence",
        "armor" = backup."armor",
        "progressionVersion" = 1,
        "progressionChoices" = '[]'::jsonb,
        "legacyStatAdjustment" = '{}'::jsonb,
        "statRevision" = "statRevision" + 1,
        "stateVersion" = GREATEST(character."stateVersion", backup."stateVersion") + 1,
        "updatedAt" = NOW()
      FROM "CharacterProgressionMigrationBackup" backup
      WHERE character."id" = backup."characterId" AND character."progressionVersion" = 2
    `);
  });
  console.log(`Rolled back ${count} character(s).`);
}

async function main(): Promise<void> {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: connectionString() }) });
  try {
    const command = process.argv[2] ?? 'status';
    const dryRun = process.argv.includes('--dry-run');
    if (command === 'status') await status(prisma);
    else if (command === 'migrate') await migrate(prisma, dryRun);
    else if (command === 'rollback') await rollback(prisma, dryRun);
    else throw new Error('Usage: npm run progression -- status|migrate|rollback [--dry-run]');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
