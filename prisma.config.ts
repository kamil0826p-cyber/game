import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/content.cli.ts deploy --operation-id=prisma-seed',
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? 'postgresql://game:game@localhost:5432/grid_mmorpg?schema=public',
  },
  experimental: { externalTables: true },
  tables: {
    external: [
      'public.ContentRelease',
      'public.DomainEvent',
      'public.EventOutbox',
      'public.EventInbox',
      'public.ContributionLedger',
    ],
  },
});
