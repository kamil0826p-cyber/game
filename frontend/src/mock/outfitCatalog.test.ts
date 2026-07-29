import { describe, expect, it } from 'vitest';
import { OUTFIT_CATALOG, outfitImageUrl } from './outfitCatalog';

const expectedUnlockLevels = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

describe('outfit catalog', () => {
  it('contains eleven outfits for every character class', () => {
    for (const outfits of Object.values(OUTFIT_CATALOG)) {
      expect(outfits).toHaveLength(11);
    }
  });

  it('unlocks the starting outfit at level one and the rest every ten levels', () => {
    for (const outfits of Object.values(OUTFIT_CATALOG)) {
      expect(outfits.map((outfit) => outfit.unlockLevel)).toEqual(expectedUnlockLevels);
    }
  });

  it('uses a unique static sprite path for every outfit', () => {
    const keys = Object.values(OUTFIT_CATALOG).flat().map((outfit) => outfit.key);
    const spritePaths = keys.map(outfitImageUrl);

    expect(keys).toHaveLength(33);
    expect(new Set(keys).size).toBe(33);
    expect(new Set(spritePaths).size).toBe(33);
    expect(spritePaths.every((path) => path.endsWith('.svg?v=8'))).toBe(true);
  });
});
