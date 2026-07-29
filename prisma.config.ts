import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed-all.ts' },
  datasource: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? 'postgresql://game:game@localhost:5432/grid_mmorpg?schema=public' },
});
