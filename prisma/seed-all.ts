import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.ts';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDirectory, '..');
const tsxCli = resolve(repositoryRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://game:game@localhost:5432/grid_mmorpg?schema=public';
const realmSlug = process.env.GAME_REALM_SLUG ?? 'world-1';

function runSeed(): void {
  const result = spawnSync(process.execPath, [tsxCli, resolve(currentDirectory, 'seed.ts')], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Unified content seed failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

async function verifyContent(): Promise<void> {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const realm = await prisma.realm.findUnique({ where: { slug: realmSlug } });
    if (!realm) throw new Error(`Seed verification failed: realm ${realmSlug} does not exist.`);
    const map = await prisma.map.findUnique({
      where: { realmId_key: { realmId: realm.id, key: 'greenfields' } },
    });
    if (!map) throw new Error('Seed verification failed: Greenfields does not exist.');

    const [quest, mira, borin, activeRows] = await Promise.all([
      prisma.questDefinition.findUnique({ where: { key: 'rabbit-fur-for-mira' } }),
      prisma.npcDefinition.findUnique({
        where: { mapId_key: { mapId: map.id, key: 'mira-tanner' } },
      }),
      prisma.npcDefinition.findUnique({
        where: { mapId_key: { mapId: map.id, key: 'quartermaster' } },
      }),
      prisma.$queryRaw<Array<{ hash: string; sequence: bigint }>>(Prisma.sql`
        SELECT release."hash", release."sequence"
        FROM "ContentState" state
        JOIN "ContentRelease" release ON release."id" = state."activeReleaseId"
        WHERE state."key" = 'global'
      `),
    ]);
    if (!quest || !mira || !borin) {
      throw new Error('Seed verification failed: required quest and NPC content is incomplete.');
    }
    const active = activeRows[0];
    if (!active || !/^[0-9a-f]{64}$/.test(active.hash)) {
      throw new Error('Seed verification failed: active content release is missing or malformed.');
    }
    const dialogue = mira.dialogue as { type?: unknown; quest?: { questKey?: unknown } } | null;
    if (dialogue?.type !== 'QUEST' || dialogue.quest?.questKey !== quest.key) {
      throw new Error('Seed verification failed: Mira is not connected to the rabbit-fur quest.');
    }

    console.log(
      `Verified active content release #${active.sequence} ${active.hash}, quest ${quest.key}, and NPCs ${mira.key}/${borin.key}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  runSeed();
  await verifyContent();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
