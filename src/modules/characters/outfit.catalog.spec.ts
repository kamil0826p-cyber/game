import { describe, expect, it } from 'vitest';
import { CHARACTER_CLASSES } from '../../common/domain/game.types.js';
import { OUTFIT_CATALOG, getDefaultOutfit, getUnlockedOutfits, isOutfitUnlocked } from './outfit.catalog.js';

describe('outfit catalog', () => {
  it.each(CHARACTER_CLASSES)('contains eleven unique outfits for %s', (characterClass) => {
    const outfits = OUTFIT_CATALOG[characterClass];

    expect(outfits).toHaveLength(11);
    expect(new Set(outfits.map((outfit) => outfit.key)).size).toBe(11);
    expect(outfits.every((outfit) => outfit.characterClass === characterClass)).toBe(true);
    expect(outfits.map((outfit) => outfit.unlockLevel)).toEqual([1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });

  it.each(CHARACTER_CLASSES)('provides only the starting outfit at level one for %s', (characterClass) => {
    const unlocked = getUnlockedOutfits(characterClass, 1);

    expect(unlocked).toEqual([getDefaultOutfit(characterClass)]);
  });

  it('does not unlock another class outfit', () => {
    expect(isOutfitUnlocked('MAGE', 100, 'warrior-recruit')).toBe(false);
  });

  it('unlocks each advanced outfit at its ten-level threshold', () => {
    expect(isOutfitUnlocked('ARCHER', 79, 'archer-moon')).toBe(false);
    expect(isOutfitUnlocked('ARCHER', 80, 'archer-moon')).toBe(true);
    expect(isOutfitUnlocked('ARCHER', 99, 'archer-starshot')).toBe(false);
    expect(isOutfitUnlocked('ARCHER', 100, 'archer-starshot')).toBe(true);
  });
});
