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
const expectedLevels = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

describe('character roster rules', () => {
  it('limits a realm roster to five characters', () => {
    expect(MAX_CHARACTERS_PER_REALM).toBe(5);
  });

  it.each(CHARACTER_CLASSES)('defines eleven selectable outfits for %s', (characterClass) => {
    const outfits = OUTFIT_CATALOG[characterClass];
    expect(outfits).toHaveLength(11);
    expect(new Set(outfits.map((outfit) => outfit.key)).size).toBe(11);
    expect(outfits.map((outfit) => outfit.unlockLevel)).toEqual(expectedLevels);
    expect(outfits.every((outfit) => outfit.characterClass === characterClass)).toBe(true);
  });

  it.each(CHARACTER_CLASSES)('unlocks outfits cumulatively for %s', (characterClass) => {
    expect(getUnlockedOutfits(characterClass, 1)).toEqual([getDefaultOutfit(characterClass)]);
    expect(getUnlockedOutfits(characterClass, 10)).toHaveLength(2);
    expect(getUnlockedOutfits(characterClass, 100)).toHaveLength(11);
    expect(isOutfitUnlocked(characterClass, 9, OUTFIT_CATALOG[characterClass][1]!.key)).toBe(false);
    expect(isOutfitUnlocked(characterClass, 10, OUTFIT_CATALOG[characterClass][1]!.key)).toBe(true);
  });
});

describe('character roster socket schemas', () => {
  it('accepts a valid character creation request with a selected outfit', () => {
    expect(createCharacterSchema.parse({
      requestId: 'create-1',
      name: 'Rowan Storm',
      characterClass: 'MAGE',
      outfitKey: 'mage-apprentice',
    })).toEqual({
      requestId: 'create-1',
      name: 'Rowan Storm',
      characterClass: 'MAGE',
      gender: 'MALE',
      outfitKey: 'mage-apprentice',
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
      outfitKey: 'mage-scholar',
    }).outfitKey).toBe('mage-scholar');
  });
});
