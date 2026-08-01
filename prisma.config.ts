import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/content.cli.ts deploy --author=prisma-seed',
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? 'postgresql://game:game@localhost:5432/grid_mmorpg?schema=public',
  },
  tables: {
    external: [
      'public.ContentRelease',
      'public.ContentPatch',
      'public.ContentDeploymentAttempt',
      'public.DomainEvent',
      'public.EventOutbox',
      'public.EventInbox',
      'public.ContributionLedger',
      'public.RewardAuditLedger',
      'public.AnalyticsEvent',
      'public.AnalyticsDelivery',
      'public.AnalyticsExperiment',
      'public.AnalyticsExperimentAssignment',
      'public.CharacterProgressionAudit',
      'public.CharacterProgressionMigrationBackup',
    ],
  },
});
