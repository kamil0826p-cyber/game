import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { createInitialBuildData } from '../src/modules/skills/skill.buildcraft.rules.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://game:game@localhost:5432/grid_mmorpg?schema=public';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const command = process.argv[2] ?? 'status';
const dryRun = process.argv.includes('--dry-run');

const status = async (): Promise<void> => {
  const [characters, states] = await Promise.all([
    prisma.character.count(),
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS "count" FROM "CharacterSkillBuildState"
    `,
  ]);
  const migrated = Number(states[0]?.count ?? 0n);
  console.log(JSON.stringify({ characters, migrated, pending: characters - migrated }, null, 2));
};

const migrate = async (): Promise<void> => {
  const result = await prisma.$transaction(
    async (transaction) => {
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtext('skill-build-migration-v1'))
      `;
      const characters = await transaction.character.findMany({
        where: {
          NOT: {
            id: {
              in: (
                await transaction.$queryRaw<Array<{ characterId: string }>>`
                  SELECT "characterId" FROM "CharacterSkillBuildState"
                `
              ).map((row) => row.characterId),
            },
          },
        },
        select: {
          id: true,
          skills: {
            select: {
              rank: true,
              cooldownTurnsRemaining: true,
              skillDefinition: { select: { key: true, displayOrder: true } },
            },
          },
        },
        orderBy: { id: 'asc' },
      });
      const plans = characters.map((character) => {
        const learned = [...character.skills]
          .sort(
            (first, second) =>
              first.skillDefinition.displayOrder - second.skillDefinition.displayOrder,
          )
          .map((entry) => ({
            skillKey: entry.skillDefinition.key,
            rank: entry.rank,
            cooldownTurnsRemaining: entry.cooldownTurnsRemaining,
          }));
        const data = createInitialBuildData(learned, new Date().toISOString());
        return { characterId: character.id, learned, data };
      });
      if (!dryRun) {
        for (const plan of plans) {
          const json = JSON.stringify(plan.data);
          await transaction.$executeRaw`
            INSERT INTO "CharacterSkillBuildState" (
              "characterId", "version", "data", "createdAt", "updatedAt"
            ) VALUES (${plan.characterId}::uuid, 1, ${json}::jsonb, NOW(), NOW())
            ON CONFLICT ("characterId") DO NOTHING
          `;
        }
      }
      return plans.map((plan) => ({
        characterId: plan.characterId,
        preservedSkills: plan.learned,
        plannedLoadouts: plan.data.loadouts.map((loadout) => ({
          id: loadout.id,
          activeSkillKeys: loadout.activeSkillKeys,
          passiveNodeKeys: loadout.passiveNodeKeys,
          isValid: loadout.isValid,
          invalidReasons: loadout.invalidReasons,
        })),
        requiredRepairs: {
          nodeKeys: [],
          loadoutIds: plan.data.loadouts
            .filter((loadout) => !loadout.isValid)
            .map((loadout) => loadout.id),
        },
        freeRespecAvailable: plan.data.freeRespecAvailable,
      }));
    },
    { maxWait: 10_000, timeout: 120_000 },
  );
  console.log(JSON.stringify({ dryRun, processed: result.length, characters: result }, null, 2));
};

const rollback = async (): Promise<void> => {
  const rows = await prisma.$queryRaw<Array<{ characterId: string }>>`
    SELECT "characterId" FROM "CharacterSkillBuildState" ORDER BY "characterId"
  `;
  if (!dryRun) {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtext('skill-build-migration-v1'))
      `;
      await transaction.$executeRaw`DELETE FROM "CharacterSkillBuildState"`;
    });
  }
  console.log(
    JSON.stringify(
      { dryRun, processed: rows.length, characterIds: rows.map((row) => row.characterId) },
      null,
      2,
    ),
  );
};

try {
  if (command === 'status') await status();
  else if (command === 'migrate') await migrate();
  else if (command === 'rollback') await rollback();
  else throw new Error(`Unknown command: ${command}`);
} finally {
  await prisma.$disconnect();
}
