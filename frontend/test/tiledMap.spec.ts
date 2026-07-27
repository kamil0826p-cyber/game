import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileMapDefinition, isCollisionTile, parseTiledMap } from '../src/game/map/tiledMap';

const loadFixture = async (name: string) => {
  const raw = await readFile(resolve(process.cwd(), 'public/maps', name), 'utf8');
  const key = name.replace('.json', '');
  return compileMapDefinition(key, parseTiledMap(JSON.parse(raw)), `/maps/${name}`);
};

const visibleObstacleGids = new Set([5, 7, 8, 9, 11, 12]);

const assertVisibleObstaclesMatchCollision = async (name: string) => {
  const map = await loadFixture(name);
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const hasVisibleObstacle = map.renderLayers.some((layer) => {
        const localX = x - layer.tileOffsetX;
        const localY = y - layer.tileOffsetY;
        if (localX < 0 || localY < 0 || localX >= layer.width || localY >= layer.height) {
          return false;
        }
        return visibleObstacleGids.has(layer.data[localY * layer.width + localX] ?? 0);
      });
      if (hasVisibleObstacle) {
        expect(isCollisionTile(map, x, y), `${name} obstacle at ${x},${y}`).toBe(true);
      }
    }
  }
};

describe('Tiled map compiler', () => {
  it('compiles the rebuilt forest, river bridge and cave portal', async () => {
    const map = await loadFixture('greenfields.json');
    expect([map.width, map.height]).toEqual([32, 24]);
    expect(map.renderLayers.map((layer) => layer.name)).toEqual([
      'Ground',
      'Roads, river and bridge',
      'Forest canopy and details',
    ]);
    expect(isCollisionTile(map, 0, 0)).toBe(true);
    expect(isCollisionTile(map, 4, 12)).toBe(false);
    expect(isCollisionTile(map, 15, 5)).toBe(true);
    expect(isCollisionTile(map, 15, 12)).toBe(false);
    expect(isCollisionTile(map, 28, 11)).toBe(false);
    expect(map.portals[0]).toEqual({
      sourceX: 28,
      sourceY: 11,
      destinationMapKey: 'crystal-cave',
      targetX: 2,
      targetY: 11,
    });
  });

  it('compiles the rebuilt cave, chambers, abyss bridge and forest exit', async () => {
    const map = await loadFixture('crystal-cave.json');
    expect([map.width, map.height]).toEqual([28, 22]);
    expect(map.renderLayers.map((layer) => layer.name)).toEqual([
      'Cave floor',
      'Walls, abyss and bridge',
      'Crystals and cave details',
    ]);
    expect(isCollisionTile(map, 0, 0)).toBe(true);
    expect(isCollisionTile(map, 1, 11)).toBe(false);
    expect(isCollisionTile(map, 3, 11)).toBe(false);
    expect(isCollisionTile(map, 17, 8)).toBe(true);
    expect(isCollisionTile(map, 21, 10)).toBe(true);
    expect(isCollisionTile(map, 21, 11)).toBe(false);
    expect(map.portals[0]).toEqual({
      sourceX: 1,
      sourceY: 11,
      destinationMapKey: 'greenfields',
      targetX: 27,
      targetY: 11,
    });
  });

  it('keeps visible obstacle tiles synchronized with collision', async () => {
    await assertVisibleObstaclesMatchCollision('greenfields.json');
    await assertVisibleObstaclesMatchCollision('crystal-cave.json');
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
