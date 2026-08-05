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

  it('gives every outfit and gender its own directly loadable SVG path', () => {
    const keys = Object.values(OUTFIT_CATALOG)
      .flat()
      .map((outfit) => outfit.key);
    const malePaths = keys.map((key) => outfitImageUrl(key, 'MALE'));
    const femalePaths = keys.map((key) => outfitImageUrl(key, 'FEMALE'));

    expect(keys).toHaveLength(33);
    expect(new Set(keys).size).toBe(33);
    expect(new Set([...malePaths, ...femalePaths]).size).toBe(66);
    expect(malePaths.every((path) => path.includes('assets/sprites/male/'))).toBe(true);
    expect(femalePaths.every((path) => path.includes('assets/sprites/female/'))).toBe(true);
    expect([...malePaths, ...femalePaths].every((path) => path.endsWith('.svg?v=18'))).toBe(true);
  });

  it('encodes outfit keys before building the gender-specific asset URL', () => {
    expect(outfitImageUrl('future outfit', 'MALE')).toContain('future%20outfit.svg?v=18');
    expect(outfitImageUrl('future outfit', 'FEMALE')).toContain(
      'sprites/female/future%20outfit.svg?v=18',
    );
  });

  it('never substitutes another outfit or gender image', () => {
    for (const outfit of Object.values(OUTFIT_CATALOG).flat()) {
      expect(outfitImageCandidates(outfit.key, 'MALE')).toEqual([
        outfitImageUrl(outfit.key, 'MALE'),
      ]);
      expect(outfitImageCandidates(outfit.key, 'FEMALE')).toEqual([
        outfitImageUrl(outfit.key, 'FEMALE'),
      ]);
    }

    expect(outfitImageCandidates('mage-evoker', 'MALE')[0]).not.toContain('mage-archmage');
    expect(outfitImageCandidates('warrior-warlord', 'FEMALE')[0]).not.toContain(
      'warrior-champion',
    );
    expect(outfitImageCandidates('archer-starshot', 'MALE')[0]).not.toContain('archer-ranger');
  });
});
