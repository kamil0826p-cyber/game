import { describe, expect, it } from 'vitest';
import {
  getOutfitForLevel,
  OUTFIT_CATALOG,
} from '../src/modules/characters/outfit.catalog.js';

const expectedLevels = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

describe('outfit catalog', () => {
  it('contains one unique physical outfit for every ten-level tier', () => {
    for (const outfits of Object.values(OUTFIT_CATALOG)) {
      expect(outfits).toHaveLength(11);
      expect(outfits.map((outfit) => outfit.unlockLevel)).toEqual(expectedLevels);
      expect(new Set(outfits.map((outfit) => outfit.key)).size).toBe(11);
    }
  });

  it('selects exactly one outfit from class and current level', () => {
    expect(getOutfitForLevel('MAGE', 1).key).toBe('mage-apprentice');
    expect(getOutfitForLevel('MAGE', 9).key).toBe('mage-apprentice');
    expect(getOutfitForLevel('MAGE', 10).key).toBe('mage-scholar');
    expect(getOutfitForLevel('MAGE', 99).key).toBe('mage-voidseer');
    expect(getOutfitForLevel('MAGE', 100).key).toBe('mage-ascendant');
    expect(getOutfitForLevel('MAGE', 999).key).toBe('mage-ascendant');
  });
});
