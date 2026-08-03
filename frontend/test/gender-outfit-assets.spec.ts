import { describe, expect, it } from 'vitest';
import { OUTFIT_CATALOG, outfitImageUrl } from '../src/mock/outfitCatalog';

describe('gender-specific outfit assets', () => {
  const outfits = Object.values(OUTFIT_CATALOG).flat();

  it('keeps one dedicated asset path for every gender and outfit', () => {
    expect(outfits).toHaveLength(33);
    for (const outfit of outfits) {
      const male = outfitImageUrl(outfit.key, 'MALE');
      const female = outfitImageUrl(outfit.key, 'FEMALE');
      expect(male).toContain(`/assets/sprites/male/${outfit.key}.png?v=16`);
      expect(female).toContain(`/assets/sprites/female/${outfit.key}.png?v=16`);
      expect(male).not.toBe(female);
    }
  });

  it('does not expose legacy or class-level fallback paths', () => {
    const path = outfitImageUrl('warrior-warlord', 'MALE');
    expect(path).not.toContain('/assets/sprites/warrior-warlord.png');
    expect(path).not.toContain('warrior-champion');
    expect(path).not.toContain('.svg');
  });
});
