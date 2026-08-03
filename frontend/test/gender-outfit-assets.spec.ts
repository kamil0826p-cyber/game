import { describe, expect, it } from 'vitest';
import { OUTFIT_CATALOG, outfitImageCandidates, outfitImageUrl } from '../src/mock/outfitCatalog';

describe('gender-specific outfit assets', () => {
  const outfits = Object.values(OUTFIT_CATALOG).flat();

  it('keeps one dedicated asset path for every gender and outfit', () => {
    expect(outfits).toHaveLength(33);
    for (const outfit of outfits) {
      const male = outfitImageUrl(outfit.key, 'MALE');
      const female = outfitImageUrl(outfit.key, 'FEMALE');
      expect(male).toContain(`/assets/sprites/male/${outfit.key}.png`);
      expect(female).toContain(`/assets/sprites/female/${outfit.key}.png`);
      expect(male).not.toBe(female);
    }
  });

  it('does not fall back to legacy, SVG, or another outfit artwork', () => {
    for (const gender of ['MALE', 'FEMALE'] as const) {
      for (const outfit of outfits) {
        const candidates = outfitImageCandidates(outfit.key, gender);
        expect(candidates).toEqual([outfitImageUrl(outfit.key, gender)]);
        expect(candidates[0]).not.toMatch(/\/assets\/sprites\/[^/]+\.(png|svg)/);
      }
    }
  });
});
