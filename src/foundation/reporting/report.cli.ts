import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import {
  accountFunnelReport,
  buildFoundationReports,
  combatReport,
  diagnosticsReport,
  economyReport,
  itemFlowReport,
  retentionReport,
  sessionDurationReport,
} from './production-reports.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://game:game@localhost:5432/grid_mmorpg?schema=public';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'all';
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const report =
      command === 'all'
        ? await buildFoundationReports(prisma)
        : command === 'funnel'
          ? await accountFunnelReport(prisma)
          : command === 'retention'
            ? {
                retention: await retentionReport(prisma),
                sessions: await sessionDurationReport(prisma),
              }
            : command === 'economy'
              ? await economyReport(prisma)
              : command === 'items'
                ? await itemFlowReport(prisma)
                : command === 'combat'
                  ? await combatReport(prisma)
                  : command === 'diagnostics'
                    ? await diagnosticsReport(prisma)
                    : undefined;
    if (!report) {
      throw new Error('Usage: report.cli.ts <all|funnel|retention|economy|items|combat|diagnostics>');
    }
    console.log(JSON.stringify(report, (_, value) => (typeof value === 'bigint' ? value.toString() : value), 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
