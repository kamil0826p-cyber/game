import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import type { PrismaService } from '../src/database/prisma.service.ts';
import { CharacterProgressionService } from '../src/modules/characters/progression/character-progression.service.ts';

const connectionString =
  process.env.DIRECT_URL ??
  process.env.DATABASE_URL ??
  'postgresql://game:game@localhost:5432/grid_mmorpg?schema=public';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'status';
  const dryRun = process.argv.includes('--dry-run');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const progression = new CharacterProgressionService(prisma as unknown as PrismaService);
  try {
    switch (command) {
      case 'status':
        console.log(JSON.stringify(await progression.migrationStatus(), null, 2));
        break;
      case 'migrate':
        console.log(JSON.stringify(await progression.migrateAll(dryRun), null, 2));
        break;
      case 'rollback':
        console.log(JSON.stringify(await progression.rollbackAll(dryRun), null, 2));
        break;
      default:
        throw new Error(
          `Unknown command ${command}. Use status, migrate [--dry-run], or rollback [--dry-run].`,
        );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
