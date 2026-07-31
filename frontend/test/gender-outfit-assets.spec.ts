import { describe, expect, it } from 'vitest';
import { OUTFIT_CATALOG, outfitImageCandidates } from '../src/mock/outfitCatalog';

describe('gender-specific outfit assets', () => {
  const outfits = Object.values(OUTFIT_CATALOG).flat();

  it('keeps a dedicated asset path for every gender and outfit', () => {
    expect(outfits).toHaveLength(33);
    for (const outfit of outfits) {
      const male = outfitImageCandidates(outfit.key, 'MALE');
      const female = outfitImageCandidates(outfit.key, 'FEMALE');
      expect(male[0]).toContain(`/assets/sprites/male/${outfit.key}.png`);
      expect(female[0]).toContain(`/assets/sprites/female/${outfit.key}.png`);
      expect(male[0]).not.toBe(female[0]);
      expect(male.slice(1)).toEqual(female.slice(1));
    }
  });

  it('retains legacy files as a safe rollout fallback', () => {
    const candidates = outfitImageCandidates('mage-apprentice', 'FEMALE');
    expect(candidates.some((candidate) => candidate.includes('/assets/sprites/mage-apprentice.png'))).toBe(true);
  });
});
