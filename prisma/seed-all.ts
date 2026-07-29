import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDirectory, '..');
const tsxCli = resolve(repositoryRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://game:game@localhost:5432/grid_mmorpg?schema=public';
const realmSlug = process.env.GAME_REALM_SLUG ?? 'world-1';

function runSeed(scriptName: string): void {
  const scriptPath = resolve(currentDirectory, scriptName);
  const result = spawnSync(process.execPath, [tsxCli, scriptPath], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Seed script ${scriptName} failed with exit code ${result.status ?? 'unknown'}.`);
  }
}

async function verifyQuestContent(): Promise<void> {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const realm = await prisma.realm.findUnique({ where: { slug: realmSlug } });
    if (!realm) throw new Error(`Seed verification failed: realm ${realmSlug} does not exist.`);

    const map = await prisma.map.findUnique({
      where: { realmId_key: { realmId: realm.id, key: 'greenfields' } },
    });
    if (!map) throw new Error('Seed verification failed: Greenfields does not exist.');

    const [quest, npc] = await Promise.all([
      prisma.questDefinition.findUnique({ where: { key: 'rabbit-fur-for-mira' } }),
      prisma.npcDefinition.findUnique({
        where: { mapId_key: { mapId: map.id, key: 'mira-tanner' } },
      }),
    ]);

    if (!quest) throw new Error('Seed verification failed: rabbit-fur-for-mira quest does not exist.');
    if (!npc) throw new Error('Seed verification failed: Mira quest NPC does not exist.');
    if (npc.outfitKey !== 'npc-quest-mira') {
      throw new Error(`Seed verification failed: Mira has unexpected outfit ${npc.outfitKey}.`);
    }

    const dialogue = npc.dialogue as { type?: unknown; quest?: { questKey?: unknown } } | null;
    if (dialogue?.type !== 'QUEST' || dialogue.quest?.questKey !== quest.key) {
      throw new Error('Seed verification failed: Mira is not connected to the rabbit-fur quest.');
    }

    console.log(
      `Verified quest NPC ${npc.name} (${npc.key}) on Greenfields at ${npc.x},${npc.y}, connected to ${quest.key}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  runSeed('seed.ts');
  runSeed('seed-quests.ts');
  await verifyQuestContent();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
