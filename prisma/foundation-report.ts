import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import {
  buildEconomyReconciliation,
  buildProductReport,
} from '../src/foundation/reports/foundation-report.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://game:game@localhost:5432/grid_mmorpg?schema=public';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main(): Promise<void> {
  const [economy, product] = await Promise.all([
    buildEconomyReconciliation(prisma),
    buildProductReport(prisma),
  ]);
  console.log(JSON.stringify({ economy, product }, null, 2));
  if (!economy.balanced) process.exitCode = 2;
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
