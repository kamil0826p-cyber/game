import { describe, expect, it } from 'vitest';
import {
  getUnlockedOutfits,
  isOutfitUnlocked,
  OUTFIT_CATALOG,
} from '../src/modules/characters/outfit.catalog.js';

describe('outfit catalog', () => {
  it('contains exactly two outfits per class at levels 1 and 10', () => {
    for (const outfits of Object.values(OUTFIT_CATALOG)) {
      expect(outfits).toHaveLength(2);
      expect(outfits.map((outfit) => outfit.unlockLevel)).toEqual([1, 10]);
    }
  });

  it('unlocks the second class outfit at level 10', () => {
    expect(getUnlockedOutfits('MAGE', 9).map((outfit) => outfit.key)).toEqual([
      'mage-apprentice',
    ]);
    expect(getUnlockedOutfits('MAGE', 10).map((outfit) => outfit.key)).toEqual([
      'mage-apprentice',
      'mage-archmage',
    ]);
    expect(isOutfitUnlocked('MAGE', 9, 'mage-archmage')).toBe(false);
  });
});
