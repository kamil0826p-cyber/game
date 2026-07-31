import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value: string) => value.startsWith(prefix))?.slice(prefix.length);
}

async function main(): Promise<void> {
  if (process.argv[2] !== 'replay') {
    throw new Error('Usage: npm run events:replay -- [--type=EventType] [--from=ISO] [--to=ISO]');
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const type = argument('type');
  const from = argument('from');
  const to = argument('to');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const count = await prisma.$executeRaw(Prisma.sql`
      UPDATE "EventOutbox" AS outbox
      SET "status" = 'PENDING', "attempts" = 0, "nextAttemptAt" = NOW(),
          "lockedAt" = NULL, "publishedAt" = NULL, "lastError" = NULL, "updatedAt" = NOW()
      FROM "DomainEvent" AS event
      WHERE outbox."eventId" = event."id"
        AND (${type ?? null}::text IS NULL OR event."type" = ${type ?? null})
        AND (${from ?? null}::timestamptz IS NULL OR event."occurredAt" >= ${from ?? null}::timestamptz)
        AND (${to ?? null}::timestamptz IS NULL OR event."occurredAt" <= ${to ?? null}::timestamptz)
    `);
    console.log(`Queued ${count} domain event(s) for replay. Existing inbox receipts keep consumers idempotent.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
