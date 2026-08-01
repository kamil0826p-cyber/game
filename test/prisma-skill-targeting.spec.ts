import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const TACTICAL_TARGETINGS = [
  'SELF',
  'ALLY',
  'ENEMY',
  'AREA',
  'ALL_ALLIES',
  'ALL_ENEMIES',
  'FRONT_ROW',
  'BACK_ROW',
  'ADJACENT',
] as const;

describe('Prisma tactical skill targeting contract', () => {
  it('keeps every runtime targeting in the Prisma enum', () => {
    const schema = readFileSync(resolve(process.cwd(), 'prisma/schema.prisma'), 'utf8');
    const enumBody = schema.match(/enum SkillTargeting \{([\s\S]*?)\}/u)?.[1] ?? '';

    for (const targeting of TACTICAL_TARGETINGS) {
      expect(enumBody.split(/\r?\n/u).map((line) => line.trim())).toContain(targeting);
    }
  });

  it('migrates every tactical targeting added after the original enum', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'prisma/migrations/20260801071500_tactical_skill_targeting/migration.sql'),
      'utf8',
    );

    for (const targeting of TACTICAL_TARGETINGS.filter(
      (value) => !['SELF', 'ENEMY', 'AREA'].includes(value),
    )) {
      expect(migration).toContain(`ADD VALUE IF NOT EXISTS '${targeting}'`);
    }
  });
});
