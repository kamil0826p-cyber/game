import { describe, expect, it } from 'vitest';
import { OUTFIT_CATALOG, outfitImageUrl } from './outfitCatalog';

const expectedUnlockLevels = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

describe('outfit catalog', () => {
  it('contains eleven selectable outfits for every character class', () => {
    for (const outfits of Object.values(OUTFIT_CATALOG)) {
      expect(outfits).toHaveLength(11);
      expect(outfits.map((outfit) => outfit.unlockLevel)).toEqual(expectedUnlockLevels);
      expect(new Set(outfits.map((outfit) => outfit.key)).size).toBe(11);
    }
  });

  it('gives every outfit and gender one exact PNG path', () => {
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
});
