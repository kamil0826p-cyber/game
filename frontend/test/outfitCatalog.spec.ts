import { describe, expect, it } from 'vitest';
import { CHARACTER_CLASSES } from '../src/contracts/game';
import { OUTFIT_CATALOG } from '../src/mock/outfitCatalog';

describe('frontend outfit catalog', () => {
  it.each(CHARACTER_CLASSES)('contains ten ordered outfits for %s', (characterClass) => {
    const outfits = OUTFIT_CATALOG[characterClass];
    expect(outfits).toHaveLength(10);
    expect(new Set(outfits.map((outfit) => outfit.key)).size).toBe(10);
    expect(outfits[0]?.unlockLevel).toBe(1);
    expect(outfits[1]?.unlockLevel).toBe(1);
    expect(outfits.every((outfit, index) => index === 0 || outfit.unlockLevel >= outfits[index - 1]!.unlockLevel)).toBe(true);
  });
});
