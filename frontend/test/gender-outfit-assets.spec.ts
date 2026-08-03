import { describe, expect, it } from 'vitest';
import { OUTFIT_CATALOG, outfitImageUrl } from '../src/mock/outfitCatalog';

describe('gender-specific outfit assets', () => {
  const outfits = Object.values(OUTFIT_CATALOG).flat();

  it('uses one dedicated PNG path for every gender and outfit', () => {
    expect(outfits).toHaveLength(33);
    for (const outfit of outfits) {
      const male = outfitImageUrl(outfit.key, 'MALE');
      const female = outfitImageUrl(outfit.key, 'FEMALE');
      expect(male).toContain(`/assets/sprites/male/${outfit.key}.png`);
      expect(female).toContain(`/assets/sprites/female/${outfit.key}.png`);
      expect(male).not.toBe(female);
      expect(male).not.toContain('/assets/sprites/female/');
      expect(female).not.toContain('/assets/sprites/male/');
    }
  });

  it('does not expose legacy root or class fallback candidates', () => {
    expect(outfitImageUrl('mage-evoker', 'FEMALE')).toContain('/assets/sprites/female/mage-evoker.png');
    expect(outfitImageUrl('mage-evoker', 'FEMALE')).not.toContain('mage-archmage');
  });
});
