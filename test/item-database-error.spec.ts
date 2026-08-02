import { describe, expect, it } from 'vitest';
import { isPrismaDatabaseRuleError } from '../src/modules/items/item-database-error.js';

describe('item database error detection', () => {
  it('recognizes the expedition loadout guard in the Prisma error message', () => {
    expect(isPrismaDatabaseRuleError(
      {
        code: 'P0001',
        message: 'Database error. Code: `P0001`. Message: `EXPEDITION_LOADOUT_LOCKED`',
      },
      'P0001',
      'EXPEDITION_LOADOUT_LOCKED',
    )).toBe(true);
  });

  it('recognizes the guard marker returned through Prisma metadata', () => {
    expect(isPrismaDatabaseRuleError(
      {
        code: 'P0001',
        meta: { database_error: 'EXPEDITION_LOADOUT_LOCKED' },
      },
      'P0001',
      'EXPEDITION_LOADOUT_LOCKED',
    )).toBe(true);
  });

  it('does not classify unrelated database failures as a loadout lock', () => {
    expect(isPrismaDatabaseRuleError(
      { code: 'P2002', message: 'EXPEDITION_LOADOUT_LOCKED' },
      'P0001',
      'EXPEDITION_LOADOUT_LOCKED',
    )).toBe(false);
    expect(isPrismaDatabaseRuleError(
      { code: 'P0001', message: 'ANOTHER_DATABASE_RULE' },
      'P0001',
      'EXPEDITION_LOADOUT_LOCKED',
    )).toBe(false);
  });
});
