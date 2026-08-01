import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  scripts?: Record<string, string>;
}

function readPackageManifest(): PackageManifest {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as PackageManifest;
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

  it('keeps Prisma and tsx available when NODE_ENV is production', () => {
    const npmConfig = readFileSync(resolve(process.cwd(), '.npmrc'), 'utf8');

    expect(npmConfig.split(/\r?\n/u)).toContain('include=dev');
  });
});
