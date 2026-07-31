import { describe, expect, it } from 'vitest';
import { createCharacterSchema } from '../src/contracts/socket.schemas.js';

describe('createCharacterSchema gender', () => {
  const base = {
    requestId: 'request-1',
    name: 'Aster Vale',
    characterClass: 'ARCHER' as const,
    outfitKey: 'archer-scout',
  };

  it('defaults older clients to male', () => {
    expect(createCharacterSchema.parse(base).gender).toBe('MALE');
  });

  it('accepts female and rejects unknown values', () => {
    expect(createCharacterSchema.parse({ ...base, gender: 'FEMALE' }).gender).toBe('FEMALE');
    expect(() => createCharacterSchema.parse({ ...base, gender: 'OTHER' })).toThrow();
  });
});
