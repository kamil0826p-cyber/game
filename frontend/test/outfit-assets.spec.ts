import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OUTFIT_CATALOG, outfitImageCandidates, outfitImageUrl } from '../src/mock/outfitCatalog';

describe('canonical outfit assets', () => {
  const outfits = Object.values(OUTFIT_CATALOG).flat();

  it('uses one exact asset path for every class and level outfit', () => {
    expect(outfits).toHaveLength(33);

    const paths = outfits.map((outfit) => outfitImageUrl(outfit.key));
    expect(new Set(paths).size).toBe(outfits.length);

    for (const outfit of outfits) {
      expect(outfitImageCandidates(outfit.key)).toEqual([outfitImageUrl(outfit.key)]);
      expect(existsSync(resolve('public/assets/sprites', `${outfit.key}.png`))).toBe(true);
    }
  });

  it('does not resolve gender palettes or copied outfit variants', () => {
    for (const outfit of outfits) {
      const candidates = outfitImageCandidates(outfit.key);
      expect(candidates).toHaveLength(1);
      expect(candidates[0]).toContain(`/assets/sprites/${outfit.key}.png`);
      expect(candidates[0]).not.toContain('/sprites/male/');
      expect(candidates[0]).not.toContain('/sprites/female/');
    }
  });
});
