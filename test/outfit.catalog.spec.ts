import { describe, expect, it } from 'vitest';
import {
  getUnlockedOutfits,
  isOutfitUnlocked,
  OUTFIT_CATALOG,
} from '../src/modules/characters/outfit.catalog.js';

const expectedLevels = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

describe('outfit catalog', () => {
  it('contains eleven independent outfit tiers per class', () => {
    for (const outfits of Object.values(OUTFIT_CATALOG)) {
      expect(outfits).toHaveLength(11);
      expect(outfits.map((outfit) => outfit.unlockLevel)).toEqual(expectedLevels);
      expect(new Set(outfits.map((outfit) => outfit.key)).size).toBe(11);
    }
  });

  it('unlocks outfits cumulatively while keeping earlier choices available', () => {
    expect(getUnlockedOutfits('MAGE', 9).map((outfit) => outfit.key)).toEqual([
      'mage-apprentice',
    ]);
    expect(getUnlockedOutfits('MAGE', 10).map((outfit) => outfit.key)).toEqual([
      'mage-apprentice',
      'mage-scholar',
    ]);
    expect(getUnlockedOutfits('MAGE', 100)).toHaveLength(11);
    expect(isOutfitUnlocked('MAGE', 9, 'mage-scholar')).toBe(false);
    expect(isOutfitUnlocked('MAGE', 10, 'mage-scholar')).toBe(true);
    expect(isOutfitUnlocked('MAGE', 100, 'mage-apprentice')).toBe(true);
  });
});
