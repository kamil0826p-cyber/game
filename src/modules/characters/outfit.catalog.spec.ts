import { describe, expect, it } from 'vitest';
import { CHARACTER_CLASSES } from '../../common/domain/game.types.js';
import { OUTFIT_CATALOG, getDefaultOutfit, getUnlockedOutfits, isOutfitUnlocked } from './outfit.catalog.js';

describe('outfit catalog', () => {
  it.each(CHARACTER_CLASSES)('contains ten unique outfits for %s', (characterClass) => {
    const outfits = OUTFIT_CATALOG[characterClass];

    expect(outfits).toHaveLength(10);
    expect(new Set(outfits.map((outfit) => outfit.key)).size).toBe(10);
    expect(outfits.every((outfit) => outfit.characterClass === characterClass)).toBe(true);
  });

  it.each(CHARACTER_CLASSES)('provides five immediately available outfits for %s', (characterClass) => {
    const unlocked = getUnlockedOutfits(characterClass, 1);

    expect(unlocked).toHaveLength(5);
    expect(unlocked).toContainEqual(getDefaultOutfit(characterClass));
  });

  it('does not unlock another class outfit', () => {
    expect(isOutfitUnlocked('MAGE', 99, 'warrior-recruit')).toBe(false);
  });

  it('unlocks advanced outfits only at their required level', () => {
    expect(isOutfitUnlocked('ARCHER', 19, 'archer-moon')).toBe(false);
    expect(isOutfitUnlocked('ARCHER', 20, 'archer-moon')).toBe(true);
  });
});
