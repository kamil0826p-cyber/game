import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CharacterGender } from '../src/contracts/game';
import { OUTFIT_CATALOG, outfitImageCandidates, outfitImageUrl } from '../src/mock/outfitCatalog';

const genders: ReadonlyArray<{ gender: CharacterGender; directory: 'male' | 'female' }> = [
  { gender: 'MALE', directory: 'male' },
  { gender: 'FEMALE', directory: 'female' },
];

const svgText = (path: string): string => readFileSync(path, 'utf8');
const sha256 = (path: string): string => createHash('sha256').update(svgText(path)).digest('hex');
const attribute = (svg: string, name: string): string => {
  const value = svg.match(new RegExp(`${name}="([^"]+)"`))?.[1];
  if (!value) throw new Error(`Missing ${name} on generated SVG.`);
  return value;
};

describe('high-resolution outfit assets', () => {
  const outfits = Object.values(OUTFIT_CATALOG).flat();

  it('ships exactly 33 male and 33 female sheets at 384x576', () => {
    expect(outfits).toHaveLength(33);
    for (const { gender, directory } of genders) {
      const assetDirectory = resolve('public/assets/sprites', directory);
      expect(readdirSync(assetDirectory).filter((file) => file.endsWith('.svg'))).toHaveLength(33);
      for (const outfit of outfits) {
        const path = resolve(assetDirectory, `${outfit.key}.svg`);
        expect(existsSync(path)).toBe(true);
        const svg = svgText(path);
        expect(svg).toContain('width="384" height="576"');
        expect(svg).toContain('viewBox="0 0 384 576"');
        expect(svg).toContain(`data-gender="${gender}"`);
        expect((svg.match(/data-frame="/g) ?? [])).toHaveLength(16);
        expect((svg.match(/data-part="/g) ?? []).length).toBeGreaterThan(25);
        expect(outfitImageCandidates(outfit.key, gender)).toEqual([outfitImageUrl(outfit.key, gender)]);
      }
    }
  });

  it('contains 66 distinct generated sprite sheets', () => {
    const hashes = genders.flatMap(({ directory }) =>
      outfits.map((outfit) => sha256(resolve('public/assets/sprites', directory, `${outfit.key}.svg`))),
    );
    expect(new Set(hashes).size).toBe(66);
  });

  it('uses 66 distinct structural component combinations, not recolors', () => {
    const signatures = genders.flatMap(({ directory }) =>
      outfits.map((outfit) =>
        attribute(
          svgText(resolve('public/assets/sprites', directory, `${outfit.key}.svg`)),
          'data-component-signature',
        ),
      ),
    );
    expect(new Set(signatures).size).toBe(66);
  });

  it('gives male and female variants substantially different construction', () => {
    for (const outfit of outfits) {
      const male = attribute(
        svgText(resolve('public/assets/sprites/male', `${outfit.key}.svg`)),
        'data-component-signature',
      ).split('|');
      const female = attribute(
        svgText(resolve('public/assets/sprites/female', `${outfit.key}.svg`)),
        'data-component-signature',
      ).split('|');
      expect(male.filter((component, index) => component !== female[index]).length).toBeGreaterThanOrEqual(6);
    }
  });
});
