import { describe, expect, it } from 'vitest';
import { skillRequestSchema, skillUnlockSchema } from '../src/contracts/socket.schemas.js';

describe('skill socket schemas', () => {
  it('accepts strict skill requests', () => {
    expect(skillRequestSchema.parse({ requestId: 'skill-1' })).toEqual({
      requestId: 'skill-1',
    });
    expect(skillUnlockSchema.parse({ requestId: 'skill-2', skillKey: 'mage-flame-orb' })).toEqual({
      requestId: 'skill-2',
      skillKey: 'mage-flame-orb',
    });
  });

  it('rejects unexpected fields and malformed skill keys', () => {
    expect(() =>
      skillUnlockSchema.parse({
        requestId: 'skill-2',
        skillKey: '../admin',
      }),
    ).toThrow();
    expect(() =>
      skillUnlockSchema.parse({
        requestId: 'skill-2',
        skillKey: 'mage-flame-orb',
        characterId: crypto.randomUUID(),
      }),
    ).toThrow();
  });
});
