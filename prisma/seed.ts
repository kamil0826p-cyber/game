import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { compileContentManifest } from '../src/foundation/content/content.compiler.js';
import {
  deployContentPackage,
  readActiveContentManifest,
} from '../src/foundation/content/content.deployer.js';
import { buildGameContentManifest } from './content.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://game:game@localhost:5432/grid_mmorpg?schema=public';
const realmSlug = process.env.GAME_REALM_SLUG ?? 'world-1';
const realmName = process.env.GAME_REALM_NAME ?? 'World 1';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main(): Promise<void> {
  const [manifest, previous] = await Promise.all([
    buildGameContentManifest(),
    readActiveContentManifest(prisma),
  ]);
  const compiled = compileContentManifest(manifest, previous);
  const result = await deployContentPackage(prisma, compiled, {
    realmSlug,
    realmName,
    activationReason: 'DEPLOY',
  });

  const action = result.replayed ? 'Replayed' : 'Activated';
  console.log(
    `${action} content release #${result.sequence} ${result.hash} with ${result.mapCount} maps, ${result.skillCount} combat skills, ${result.mobCount} mobs and ${result.questCount} quests.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
