import { describe, expect, it } from 'vitest';
import { OUTFIT_CATALOG, outfitImageUrl } from './outfitCatalog';

const expectedUnlockLevels = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

describe('outfit catalog', () => {
  it('contains eleven outfits for every character class', () => {
    for (const outfits of Object.values(OUTFIT_CATALOG)) expect(outfits).toHaveLength(11);
  });

  it('unlocks the starting outfit at level one and the rest every ten levels', () => {
    for (const outfits of Object.values(OUTFIT_CATALOG)) {
      expect(outfits.map((outfit) => outfit.unlockLevel)).toEqual(expectedUnlockLevels);
    }
  });

  it('maps every class to exactly two committed sprite sheets', () => {
    const allPaths = new Set<string>();
    for (const outfits of Object.values(OUTFIT_CATALOG)) {
      const paths = outfits.map((outfit) => outfitImageUrl(outfit.key));
      expect(new Set(paths).size).toBe(2);
      expect(paths.every((path) => path.endsWith('.svg?v=9'))).toBe(true);
      paths.forEach((path) => allPaths.add(path));
    }
    expect(allPaths.size).toBe(6);
  });
});
