import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSprite = (key: string): string =>
  readFileSync(resolve(process.cwd(), 'public', 'assets', 'sprites', `${key}.svg`), 'utf8');

describe('NPC sprite sheets', () => {
  it.each(['npc-warrior-merchant', 'npc-quest-mira'])('%s has the expected 4x4 sheet dimensions', (key) => {
    const source = readSprite(key);
    expect(source).toContain('width="128" height="192"');
    expect(source).toContain('viewBox="0 0 128 192"');
    expect(source).toContain('shape-rendering="crispEdges"');
  });

  it('uses independent artwork for the merchant and quest NPC', () => {
    expect(readSprite('npc-warrior-merchant')).not.toBe(readSprite('npc-quest-mira'));
  });
});
