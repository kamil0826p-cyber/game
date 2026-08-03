import { describe, expect, it } from 'vitest';
import { CHARACTER_CLASSES } from '../src/contracts/game';
import { getOutfitForLevel, OUTFIT_CATALOG } from '../src/mock/outfitCatalog';

const expectedLevels = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

describe('frontend outfit catalog', () => {
  it.each(CHARACTER_CLASSES)('contains eleven ordered level outfits for %s', (characterClass) => {
    const outfits = OUTFIT_CATALOG[characterClass];
    expect(outfits).toHaveLength(11);
    expect(new Set(outfits.map((outfit) => outfit.key)).size).toBe(11);
    expect(outfits.map((outfit) => outfit.unlockLevel)).toEqual(expectedLevels);
    expect(getOutfitForLevel(characterClass, 9)).toBe(outfits[0]);
    expect(getOutfitForLevel(characterClass, 10)).toBe(outfits[1]);
  });
});
