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

  it('gives every outfit and gender one exact PNG path', () => {
    const keys = Object.values(OUTFIT_CATALOG)
      .flat()
      .map((outfit) => outfit.key);
    const paths = keys.flatMap((key) => [
      outfitImageUrl(key, 'MALE'),
      outfitImageUrl(key, 'FEMALE'),
    ]);

    expect(keys).toHaveLength(33);
    expect(new Set(keys).size).toBe(33);
    expect(paths).toHaveLength(66);
    expect(new Set(paths).size).toBe(66);
    expect(paths.every((path) => path.includes('assets/sprites/'))).toBe(true);
    expect(paths.every((path) => path.endsWith('.png?v=16'))).toBe(true);
  });

  it('encodes outfit keys before building the asset URL', () => {
    expect(outfitImageUrl('future outfit')).toContain('future%20outfit.png?v=16');
  });

  it('never substitutes another outfit image', () => {
    expect(outfitImageUrl('mage-evoker')).toContain('/male/mage-evoker.png?v=16');
    expect(outfitImageUrl('warrior-warlord')).toContain('/male/warrior-warlord.png?v=16');
    expect(outfitImageUrl('archer-starshot')).toContain('/male/archer-starshot.png?v=16');
    expect(outfitImageUrl('warrior-warlord')).not.toContain('warrior-champion');
  });
});
