import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import { buildGameContentManifest } from '../../../prisma/content.js';
import { compileContentManifest } from './content.compiler.js';
import {
  deployContentPackage,
  readActiveContentManifest,
  readContentRelease,
} from './content.deployer.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://game:game@localhost:5432/grid_mmorpg?schema=public';
const realmSlug = process.env.GAME_REALM_SLUG ?? 'world-1';
const realmName = process.env.GAME_REALM_NAME ?? 'World 1';

function usage(): never {
  throw new Error(
    'Usage: tsx src/foundation/content/content.cli.ts <validate|deploy|rollback> [release-sequence-or-hash]',
  );
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || !['validate', 'deploy', 'rollback'].includes(command)) usage();

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    if (command === 'rollback') {
      const target = process.argv[3] ?? usage();
      const release = await readContentRelease(prisma, target);
      if (!release) throw new Error(`Content release ${target} does not exist.`);
      const active = await readActiveContentManifest(prisma);
      const compiled = compileContentManifest(release.manifest, active);
      if (compiled.hash !== release.hash) {
        throw new Error(
          `Stored release ${target} failed integrity verification: expected ${release.hash}, compiled ${compiled.hash}.`,
        );
      }
      const result = await deployContentPackage(prisma, compiled, {
        realmSlug,
        realmName,
        activationReason: 'ROLLBACK',
      });
      console.log(JSON.stringify({ command, target, ...result }, null, 2));
      return;
    }

    const [manifest, active] = await Promise.all([
      buildGameContentManifest(),
      readActiveContentManifest(prisma).catch(() => undefined),
    ]);
    const compiled = compileContentManifest(manifest, active);
    if (command === 'validate') {
      console.log(
        JSON.stringify(
          {
            valid: true,
            hash: compiled.hash,
            schemaVersion: compiled.manifest.schemaVersion,
            logicalDiff: compiled.logicalDiff,
          },
          null,
          2,
        ),
      );
      return;
    }

    const result = await deployContentPackage(prisma, compiled, {
      realmSlug,
      realmName,
      activationReason: 'DEPLOY',
    });
    console.log(JSON.stringify({ command, ...result }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
