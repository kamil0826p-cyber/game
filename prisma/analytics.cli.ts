import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';

const REPORT_VIEWS = {
  funnel: 'AnalyticsFunnelDaily',
  retention: 'AnalyticsRetentionDaily',
  economy: 'AnalyticsEconomyDaily',
  rewards: 'AnalyticsRewardFlowsDaily',
  combat: 'AnalyticsCombatHealthDaily',
  queue: 'AnalyticsQueueHealth',
  anomalies: 'AnalyticsAnomalies',
} as const;

type ReportCommand = keyof typeof REPORT_VIEWS;

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function integer(name: string, fallback?: number): number | undefined {
  const raw = argument(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`--${name} must be an integer.`);
  return value;
}

function isReportCommand(command: string): command is ReportCommand {
  return Object.prototype.hasOwnProperty.call(REPORT_VIEWS, command);
}

async function report(prisma: PrismaClient, view: string, limit: number): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT * FROM "${view}" ORDER BY 1 DESC LIMIT $1`,
    limit,
  );
  process.stdout.write(`${JSON.stringify(rows, (_, value) => typeof value === 'bigint' ? Number(value) : value, 2)}\n`);
}

async function setExperiment(prisma: PrismaClient): Promise<void> {
  const key = argument('key');
  const version = integer('version');
  const rollout = integer('rollout', 0)!;
  const variantsRaw = argument('variants');
  if (!key || version === undefined || !variantsRaw) {
    throw new Error('experiment:set requires --key, --version and --variants=control:5000,treatment:5000.');
  }
  const variants = variantsRaw.split(',').map((entry) => {
    const [variantKey, weightRaw] = entry.split(':');
    const weight = Number(weightRaw);
    if (!variantKey || !Number.isInteger(weight) || weight < 1) throw new Error(`Invalid variant ${entry}.`);
    return { key: variantKey, weight };
  });
  if (variants.reduce((sum, value) => sum + value.weight, 0) !== 10_000) throw new Error('Variant weights must total 10000.');
  if (rollout < 0 || rollout > 10_000) throw new Error('Rollout must be 0-10000.');
  const status = argument('status') === 'active' ? 'ACTIVE' : 'DISABLED';
  const salt = argument('salt') ?? randomBytes(24).toString('hex');
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "AnalyticsExperiment" (
      "key", "version", "status", "rolloutBasisPoints", "variants", "salt", "startsAt", "endsAt", "createdAt", "updatedAt"
    ) VALUES (
      ${key}, ${version}, ${status}, ${rollout}, ${JSON.stringify(variants)}::jsonb, ${salt},
      ${argument('starts-at') ?? null}::timestamptz, ${argument('ends-at') ?? null}::timestamptz, NOW(), NOW()
    ) ON CONFLICT ("key", "version") DO UPDATE SET
      "status" = EXCLUDED."status", "rolloutBasisPoints" = EXCLUDED."rolloutBasisPoints",
      "variants" = EXCLUDED."variants", "salt" = EXCLUDED."salt",
      "startsAt" = EXCLUDED."startsAt", "endsAt" = EXCLUDED."endsAt", "updatedAt" = NOW()
  `);
  console.log(`Stored experiment ${key} v${version} as ${status}.`);
}

async function disableExperiment(prisma: PrismaClient): Promise<void> {
  const key = argument('key');
  if (!key) throw new Error('experiment:disable requires --key.');
  const count = await prisma.$executeRaw(Prisma.sql`
    UPDATE "AnalyticsExperiment" SET "status" = 'DISABLED', "updatedAt" = NOW() WHERE "key" = ${key}
  `);
  console.log(`Disabled ${count} experiment definition(s) for ${key}.`);
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const command = process.argv[2] ?? 'queue';
    const limit = integer('limit', 100)!;
    if (isReportCommand(command)) await report(prisma, REPORT_VIEWS[command], limit);
    else if (command === 'experiment:set') await setExperiment(prisma);
    else if (command === 'experiment:disable') await disableExperiment(prisma);
    else throw new Error('Usage: npm run analytics -- funnel|retention|economy|rewards|combat|queue|anomalies|experiment:set|experiment:disable');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
