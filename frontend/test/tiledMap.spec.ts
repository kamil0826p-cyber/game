import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileMapDefinition, isCollisionTile, parseTiledMap } from '../src/game/map/tiledMap';

const loadFixture = async (name: string) => {
  const raw = await readFile(resolve(process.cwd(), 'public/maps', name), 'utf8');
  const key = name.replace('.json', '');
  return compileMapDefinition(key, parseTiledMap(JSON.parse(raw)), `/maps/${name}`);
};

describe('Tiled map compiler', () => {
  it('compiles the forest map and its explicit collision grid', async () => {
    const map = await loadFixture('greenfields.json');
    expect(map.renderLayers.map((layer) => layer.name)).toEqual([
      'Ground',
      'Roads and water',
      'Forest details',
    ]);
    expect(isCollisionTile(map, 0, 0)).toBe(true);
    expect(isCollisionTile(map, 3, 7)).toBe(false);
    expect(isCollisionTile(map, 17, 7)).toBe(false);
    expect(isCollisionTile(map, 13, 10)).toBe(true);
    expect(isCollisionTile(map, 13, 12)).toBe(false);
    expect(map.portals[0]).toEqual({
      sourceX: 17,
      sourceY: 7,
      destinationMapKey: 'crystal-cave',
      targetX: 2,
      targetY: 7,
    });
  });

  it('compiles the cave map and keeps the portal corridor walkable', async () => {
    const map = await loadFixture('crystal-cave.json');
    expect(map.renderLayers.map((layer) => layer.name)).toEqual([
      'Cave floor',
      'Rock walls',
      'Crystals and details',
    ]);
    expect(isCollisionTile(map, 0, 0)).toBe(true);
    expect(isCollisionTile(map, 1, 7)).toBe(false);
    expect(isCollisionTile(map, 3, 7)).toBe(false);
    expect(isCollisionTile(map, 12, 3)).toBe(true);
    expect(map.portals[0]).toEqual({
      sourceX: 1,
      sourceY: 7,
      destinationMapKey: 'greenfields',
      targetX: 16,
      targetY: 7,
    });
  });

  it('does not render collision layers even when visible', () => {
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
