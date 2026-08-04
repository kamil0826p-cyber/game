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

  it('gives every outfit its own directly loadable PNG path', () => {
    const keys = Object.values(OUTFIT_CATALOG)
      .flat()
      .map((outfit) => outfit.key);
    const paths = keys.map(outfitImageUrl);

    expect(keys).toHaveLength(33);
    expect(new Set(keys).size).toBe(33);
    expect(new Set(paths).size).toBe(33);
    expect(paths.every((path) => path.includes('assets/sprites/male/'))).toBe(true);
    expect(paths.every((path) => path.endsWith('.png?v=17'))).toBe(true);
  });

  it('encodes outfit keys before building the asset URL', () => {
    expect(outfitImageUrl('future outfit')).toContain('future%20outfit.png?v=17');
  });

  it('never substitutes another outfit image', () => {
    for (const outfit of Object.values(OUTFIT_CATALOG).flat()) {
      expect(outfitImageCandidates(outfit.key)).toEqual([outfitImageUrl(outfit.key)]);
    }

    expect(outfitImageCandidates('mage-evoker')[0]).not.toContain('mage-archmage');
    expect(outfitImageCandidates('warrior-warlord')[0]).not.toContain('warrior-champion');
    expect(outfitImageCandidates('archer-starshot')[0]).not.toContain('archer-ranger');
  });
});
