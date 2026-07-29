import { describe, expect, it } from 'vitest';
import { CHARACTER_CLASSES } from '../src/common/domain/game.types.js';
import {
  createCharacterSchema,
  selectCharacterSchema,
  updateCharacterOutfitSchema,
} from '../src/contracts/socket.schemas.js';
import { MAX_CHARACTERS_PER_REALM } from '../src/modules/characters/character.service.js';
import {
  OUTFIT_CATALOG,
  getDefaultOutfit,
  getUnlockedOutfits,
  isOutfitUnlocked,
} from '../src/modules/characters/outfit.catalog.js';

const CHARACTER_ID = 'f4fa501a-29c7-4b67-b6ae-bbcb25cd30ff';

describe('character roster rules', () => {
  it('limits a realm roster to five characters', () => {
    expect(MAX_CHARACTERS_PER_REALM).toBe(5);
  });

  it.each(CHARACTER_CLASSES)('defines exactly ten unique outfits for %s', (characterClass) => {
    const outfits = OUTFIT_CATALOG[characterClass];
    expect(outfits).toHaveLength(10);
    expect(new Set(outfits.map((outfit) => outfit.key)).size).toBe(10);
    expect(outfits.every((outfit) => outfit.characterClass === characterClass)).toBe(true);
  });

  it.each(CHARACTER_CLASSES)('offers at least two creation outfits for %s', (characterClass) => {
    expect(getUnlockedOutfits(characterClass, 1).length).toBeGreaterThanOrEqual(2);
    expect(isOutfitUnlocked(characterClass, 1, getDefaultOutfit(characterClass).key)).toBe(true);
  });
});

describe('character roster socket schemas', () => {
  it('accepts a valid character creation request with an outfit', () => {
    expect(createCharacterSchema.parse({
      requestId: 'create-1',
      name: 'Rowan Storm',
      characterClass: 'MAGE',
      outfitKey: 'mage-scholar',
    })).toEqual({
      requestId: 'create-1',
      name: 'Rowan Storm',
      characterClass: 'MAGE',
      outfitKey: 'mage-scholar',
    });
  });

  it('rejects malformed character and outfit identifiers', () => {
    expect(() => selectCharacterSchema.parse({ requestId: 'select-1', characterId: 'not-a-uuid' })).toThrow();
    expect(() => updateCharacterOutfitSchema.parse({
      requestId: 'outfit-1',
      characterId: CHARACTER_ID,
      outfitKey: '../mage',
    })).toThrow();
  });

  it('accepts selecting and updating an owned character identifier', () => {
    expect(selectCharacterSchema.parse({ requestId: 'select-1', characterId: CHARACTER_ID }).characterId).toBe(CHARACTER_ID);
    expect(updateCharacterOutfitSchema.parse({
      requestId: 'outfit-1',
      characterId: CHARACTER_ID,
      outfitKey: 'mage-archmage',
    }).outfitKey).toBe('mage-archmage');
  });
});
