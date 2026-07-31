import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { DOMAIN_EVENT_CONTRACTS, type DomainEventType } from '../src/domain-events/domain-event.contracts.js';
import { requeueDomainEvents } from '../src/domain-events/domain-event.service.js';

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function dateArgument(name: string): Date | undefined {
  const value = argument(name);
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`--${name} must be a valid ISO date.`);
  return parsed;
}

async function main(): Promise<void> {
  if (process.argv[2] !== 'replay') {
    throw new Error('Usage: npm run events:replay -- [--type=EventType] [--from=ISO] [--to=ISO] [--exclude-dead]');
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const rawType = argument('type');
  if (rawType && !(rawType in DOMAIN_EVENT_CONTRACTS)) throw new Error(`Unknown domain event type ${rawType}.`);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const count = await requeueDomainEvents(prisma, {
      type: rawType as DomainEventType | undefined,
      from: dateArgument('from'),
      to: dateArgument('to'),
      includeDead: !process.argv.includes('--exclude-dead'),
    });
    console.log(`Queued ${count} domain event(s) for replay. Existing inbox receipts keep consumer effects exactly once.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
