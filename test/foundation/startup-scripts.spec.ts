import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  scripts?: Record<string, string>;
}

describe('production startup scripts', () => {
  it('keeps prisma generation, deploy migration and seed in every server start path', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as PackageJson;
    const scripts = packageJson.scripts ?? {};
    expect(scripts['prisma:prepare']).toBe(
      'npm run prisma:generate && npm run prisma:migrate:deploy && npm run prisma:seed',
    );
    for (const name of ['start', 'start:dev', 'start:debug']) {
      expect(scripts[name], `${name} must preserve prisma:prepare`).toMatch(/^npm run prisma:prepare && /);
    }
  });
});
