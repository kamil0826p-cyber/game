import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compileMapDefinition,
  decodeTiledMapPayload,
  parseTiledMap,
} from '../src/game/map/tiledMap';

const loadFixture = async (name: string) => {
  const raw = await readFile(resolve(process.cwd(), 'public/maps', name), 'utf8');
  const decoded = await decodeTiledMapPayload(JSON.parse(raw));
  return compileMapDefinition(name.replace('.json', ''), parseTiledMap(decoded));
};

describe('Tiled map compiler', () => {
  it('rejects malformed map properties and object coordinates', () => {
    expect(() =>
      parseTiledMap({
        type: 'map',
        orientation: 'orthogonal',
        infinite: false,
        width: 1,
        height: 1,
        tilewidth: 32,
        tileheight: 32,
        tilesets: [],
        properties: [{ name: 123, value: true }],
        layers: [],
      }),
    ).toThrow();
    expect(() =>
      parseTiledMap({
        type: 'map',
        orientation: 'orthogonal',
        infinite: false,
        width: 1,
        height: 1,
        tilewidth: 32,
        tileheight: 32,
        tilesets: [],
        layers: [{ name: 'objects', type: 'objectgroup', objects: [{ x: '0', y: 0 }] }],
      }),
    ).toThrow();
  });

  it('compiles the village map collision and portal metadata', async () => {
    const map = await loadFixture('greenfields.json');
    expect(map.width).toBe(96);
    expect(map.height).toBe(64);
    expect(map.collision.length).toBe(96 * 64);
    expect(map.portals).toEqual([
      {
        sourceX: 95,
        sourceY: 32,
        destinationMapKey: 'crystal-cave',
        targetX: 1,
        targetY: 32,
      },
    ]);
  });

  it('compiles the cave map and reciprocal portal', async () => {
    const map = await loadFixture('crystal-cave.json');
    expect(map.width).toBe(96);
    expect(map.height).toBe(64);
    expect(map.portals[0]?.destinationMapKey).toBe('greenfields');
  });
});
