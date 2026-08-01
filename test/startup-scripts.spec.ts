import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  scripts?: Record<string, string>;
}

function readPackageManifest(): PackageManifest {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as PackageManifest;
}

function migrationSqlFiles(): string[] {
  const migrationsRoot = resolve(process.cwd(), 'prisma/migrations');
  return readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(migrationsRoot, entry.name, 'migration.sql'));
}

describe('backend startup scripts', () => {
  it('always prepares Prisma before starting the backend', () => {
    const scripts = readPackageManifest().scripts ?? {};

    expect(scripts.start).toBe('npm run prisma:prepare && node dist/main.js');
    expect(scripts['start:dev']).toBe('npm run prisma:prepare && nest start --watch');
    expect(scripts['start:debug']).toBe('npm run prisma:prepare && nest start --debug --watch');
  });

  it('keeps generate, migrate and seed in the required preparation chain', () => {
    const scripts = readPackageManifest().scripts ?? {};

    expect(scripts['prisma:prepare']).toBe(
      'npm run prisma:generate && npm run prisma:migrate:deploy && npm run prisma:seed',
    );
    expect(scripts['prisma:seed']).toBe('prisma db seed');
    expect(scripts['db:prepare']).toBe('npm run prisma:prepare');
  });

  it('routes Prisma seed through the versioned content deployment CLI', () => {
    const prismaConfig = readFileSync(resolve(process.cwd(), 'prisma.config.ts'), 'utf8');

    expect(prismaConfig).toContain("seed: 'tsx prisma/content.cli.ts deploy --author=prisma-seed'");
  });

  it('enables the Prisma external tables preview required by the configured tables', () => {
    const prismaConfig = readFileSync(resolve(process.cwd(), 'prisma.config.ts'), 'utf8');

    expect(prismaConfig).toMatch(/experimental:\s*\{\s*externalTables:\s*true/u);
    expect(prismaConfig).toContain('tables:');
    expect(prismaConfig).toContain('external:');
  });

  it('keeps Prisma and tsx available when NODE_ENV is production', () => {
    const npmConfig = readFileSync(resolve(process.cwd(), '.npmrc'), 'utf8');

    expect(npmConfig.split(/\r?\n/u)).toContain('include=dev');
  });

  it('does not contain malformed CREATE TRIGER statements in migrations', () => {
    const migrations = migrationSqlFiles();

    expect(migrations.length).toBeGreaterThan(0);
    for (const migration of migrations) {
      const sql = readFileSync(migration, 'utf8');
      expect(sql, migration).not.toMatch(/\bCREATE\s+TRIGER\b/iu);
    }

    const foundationMigration = readFileSync(
      resolve(
        process.cwd(),
        'prisma/migrations/20260731211500_complete_foundation/migration.sql',
      ),
      'utf8',
    );
    expect(foundationMigration).toContain(
      'CREATE TRIGGER "TradeSession_completed_domain_event_trigger"',
    );
  });
});
