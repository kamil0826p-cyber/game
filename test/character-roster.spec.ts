import { describe, expect, it } from 'vitest';
import { CHARACTER_CLASSES } from '../src/common/domain/game.types.js';
import {
  createCharacterSchema,
  selectCharacterSchema,
} from '../src/contracts/socket.schemas.js';
import { MAX_CHARACTERS_PER_REALM } from '../src/modules/characters/character.service.js';
import {
  OUTFIT_CATALOG,
  getOutfitForLevel,
} from '../src/modules/characters/outfit.catalog.js';

const CHARACTER_ID = 'f4fa501a-29c7-4b67-b6ae-bbcb25cd30ff';

describe('character roster rules', () => {
  it('limits a realm roster to five characters', () => {
    expect(MAX_CHARACTERS_PER_REALM).toBe(5);
  });

  it.each(CHARACTER_CLASSES)('defines eleven unique ten-level outfits for %s', (characterClass) => {
    const outfits = OUTFIT_CATALOG[characterClass];
    expect(outfits).toHaveLength(11);
    expect(new Set(outfits.map((outfit) => outfit.key)).size).toBe(11);
    expect(outfits.every((outfit) => outfit.characterClass === characterClass)).toBe(true);
    expect(getOutfitForLevel(characterClass, 1)).toBe(outfits[0]);
    expect(getOutfitForLevel(characterClass, 100)).toBe(outfits[10]);
  });
});

describe('character roster socket schemas', () => {
  it('accepts character creation without a client-selected outfit', () => {
    expect(createCharacterSchema.parse({
      requestId: 'create-1',
      name: 'Rowan Storm',
      characterClass: 'MAGE',
    })).toEqual({
      requestId: 'create-1',
      name: 'Rowan Storm',
      characterClass: 'MAGE',
      gender: 'MALE',
    });
  });

  it('rejects malformed character identifiers', () => {
    expect(() => selectCharacterSchema.parse({ requestId: 'select-1', characterId: 'not-a-uuid' })).toThrow();
  });

  it('accepts selecting an owned character identifier', () => {
    expect(selectCharacterSchema.parse({ requestId: 'select-1', characterId: CHARACTER_ID }).characterId).toBe(CHARACTER_ID);
  });
});
