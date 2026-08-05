import { describe, expect, it } from 'vitest';
import { OUTFIT_CATALOG, outfitImageCandidates, outfitImageUrl } from './outfitCatalog';

const expectedLevels = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

describe('outfit catalog', () => {
  it('contains eleven unique outfits per class at the expected levels', () => {
    for (const outfits of Object.values(OUTFIT_CATALOG)) {
      expect(outfits).toHaveLength(11);
      expect(outfits.map((outfit) => outfit.unlockLevel)).toEqual(expectedLevels);
    }
    const keys = Object.values(OUTFIT_CATALOG).flat().map((outfit) => outfit.key);
    expect(new Set(keys).size).toBe(33);
  });

  it('builds a distinct version-20 SVG URL for every outfit and gender', () => {
    const keys = Object.values(OUTFIT_CATALOG).flat().map((outfit) => outfit.key);
    const urls = keys.flatMap((key) => [outfitImageUrl(key, 'MALE'), outfitImageUrl(key, 'FEMALE')]);
    expect(new Set(urls).size).toBe(66);
    expect(urls.every((url) => url.endsWith('.svg?v=20'))).toBe(true);
    expect(urls.filter((url) => url.includes('/male/'))).toHaveLength(33);
    expect(urls.filter((url) => url.includes('/female/'))).toHaveLength(33);
  });

  it('encodes keys and never substitutes another outfit or gender', () => {
    expect(outfitImageUrl('future outfit', 'MALE')).toContain('/male/future%20outfit.svg?v=20');
    expect(outfitImageUrl('future outfit', 'FEMALE')).toContain('/female/future%20outfit.svg?v=20');
    for (const outfit of Object.values(OUTFIT_CATALOG).flat()) {
      expect(outfitImageCandidates(outfit.key, 'MALE')).toEqual([outfitImageUrl(outfit.key, 'MALE')]);
      expect(outfitImageCandidates(outfit.key, 'FEMALE')).toEqual([outfitImageUrl(outfit.key, 'FEMALE')]);
    }
  });
});
