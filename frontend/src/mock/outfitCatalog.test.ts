import { describe, expect, it } from 'vitest';
import { OUTFIT_CATALOG, outfitImageCandidates, outfitImageUrl } from './outfitCatalog';

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

  it('gives every outfit its own directly loadable gender-specific PNG path', () => {
    const keys = Object.values(OUTFIT_CATALOG).flat().map((outfit) => outfit.key);
    const malePaths = keys.map((key) => outfitImageUrl(key, 'MALE'));
    const femalePaths = keys.map((key) => outfitImageUrl(key, 'FEMALE'));

    expect(keys).toHaveLength(33);
    expect(new Set(keys).size).toBe(33);
    expect(new Set(malePaths).size).toBe(33);
    expect(new Set(femalePaths).size).toBe(33);
    expect(malePaths.every((path) => path.includes('/assets/sprites/male/'))).toBe(true);
    expect(femalePaths.every((path) => path.includes('/assets/sprites/female/'))).toBe(true);
    expect([...malePaths, ...femalePaths].every((path) => path.endsWith('.png?v=16'))).toBe(true);
  });

  it('encodes outfit keys before building the asset URL', () => {
    expect(outfitImageUrl('future outfit')).toContain('future%20outfit.png?v=16');
  });

  it('never substitutes another outfit as a fallback candidate', () => {
    for (const gender of ['MALE', 'FEMALE'] as const) {
      for (const outfit of Object.values(OUTFIT_CATALOG).flat()) {
        expect(outfitImageCandidates(outfit.key, gender)).toEqual([
          outfitImageUrl(outfit.key, gender),
        ]);
      }
    }
  });
});
