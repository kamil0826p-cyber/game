import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('mandatory startup preparation', () => {
  it('keeps generate, migrate deploy and seed before every backend start mode', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts['prisma:prepare']).toBe(
      'npm run prisma:generate && npm run prisma:migrate:deploy && npm run prisma:seed',
    );
    expect(packageJson.scripts.start).toMatch(/^npm run prisma:prepare && /);
    expect(packageJson.scripts['start:dev']).toMatch(/^npm run prisma:prepare && /);
    expect(packageJson.scripts['start:debug']).toMatch(/^npm run prisma:prepare && /);
  });
});
