import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileMapDefinition, parseTiledMap } from '../src/game/map/tiledMap';

const loadFixture = async (name: string) => {
  const raw = await readFile(resolve(process.cwd(), 'public/maps', name), 'utf8');
  return compileMapDefinition(name.replace('.json', ''), parseTiledMap(JSON.parse(raw)));
};

describe('Tiled map compiler', () => {
  it('compiles the village map collision and portal metadata', async () => {
    const map = await loadFixture('greenfields.json');
    expect(map.width).toBe(32);
    expect(map.height).toBe(24);
    expect(map.collision.length).toBe(32 * 24);
    expect(map.portals).toEqual([
      {
        sourceX: 28,
        sourceY: 20,
        destinationMapKey: 'crystal-cave',
        targetX: 2,
        targetY: 2,
      },
    ]);
  });

  it('compiles the cave map and reciprocal portal', async () => {
    const map = await loadFixture('crystal-cave.json');
    expect(map.width).toBe(24);
    expect(map.height).toBe(18);
    expect(map.portals[0]?.destinationMapKey).toBe('greenfields');
  });
});
