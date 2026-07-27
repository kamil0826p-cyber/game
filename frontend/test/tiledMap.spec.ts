import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileMapDefinition, parseTiledMap } from '../src/game/map/tiledMap';

const loadFixture = async (name: string) => {
  const raw = await readFile(resolve(process.cwd(), 'public/maps', name), 'utf8');
  const key = name.replace('.json', '');
  return compileMapDefinition(key, parseTiledMap(JSON.parse(raw)), `/maps/${name}`);
};

describe('Tiled map compiler', () => {
  it('compiles every visible village tile layer in Tiled order', async () => {
    const map = await loadFixture('greenfields.json');
    expect(map.width).toBe(32);
    expect(map.height).toBe(24);
    expect(map.renderLayers.map((layer) => layer.name)).toEqual([
      'Ground',
      'Paths and bridges',
      'Decorations',
    ]);
    expect(map.source.tilesets).toEqual([
      { firstgid: 1, source: 'tilesets/greenfields.tsj' },
    ]);
    expect(map.collision.length).toBe(32 * 24);
    expect(map.portals).toEqual([
      {
        sourceX: 28,
        sourceY: 12,
        destinationMapKey: 'crystal-cave',
        targetX: 2,
        targetY: 10,
      },
    ]);
  });

  it('compiles the cave layers and reciprocal portal', async () => {
    const map = await loadFixture('crystal-cave.json');
    expect(map.width).toBe(26);
    expect(map.height).toBe(20);
    expect(map.renderLayers.map((layer) => layer.name)).toEqual([
      'Cave floor',
      'Walls',
      'Details',
    ]);
    expect(map.portals[0]).toEqual({
      sourceX: 1,
      sourceY: 10,
      destinationMapKey: 'greenfields',
      targetX: 27,
      targetY: 12,
    });
  });

  it('does not render collision layers even if a map author makes them visible', () => {
    const map = parseTiledMap({
      type: 'map',
      orientation: 'orthogonal',
      infinite: false,
      width: 1,
      height: 1,
      tilewidth: 32,
      tileheight: 32,
      tilesets: [{ firstgid: 1, source: 'tilesets/test.tsj' }],
      layers: [
        { name: 'Ground', type: 'tilelayer', width: 1, height: 1, data: [1] },
        { name: 'Collision', type: 'tilelayer', width: 1, height: 1, data: [1], visible: true },
      ],
    });
    expect(compileMapDefinition('test', map).renderLayers.map((layer) => layer.name)).toEqual([
      'Ground',
    ]);
  });
});
