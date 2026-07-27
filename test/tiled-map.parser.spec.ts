import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameError } from '../src/common/errors/game.error.js';
import {
  compileCollisionGrid,
  extractEmbeddedPortals,
  parseTiledMap,
} from '../src/modules/maps/tiled-map.parser.js';

const loadMap = (name: string) =>
  parseTiledMap(JSON.parse(readFileSync(resolve(process.cwd(), 'prisma/maps', `${name}.json`), 'utf8')));

const fixture = {
  type: 'map',
  orientation: 'orthogonal',
  infinite: false,
  width: 3,
  height: 2,
  tilewidth: 32,
  tileheight: 32,
  tilesets: [{ firstgid: 1, name: 'fixture', image: 'fixture.svg', tilewidth: 32, tileheight: 32, columns: 1, tilecount: 1 }],
  layers: [
    { name: 'ground', type: 'tilelayer', width: 3, height: 2, data: [1, 1, 1, 1, 1, 1] },
    { name: 'collision', type: 'tilelayer', width: 3, height: 2, data: [0, 1, 0, 0, 0, 1] },
  ],
} as const;

describe('authoritative Tiled parsing', () => {
  it('compiles all non-zero collision GIDs', () => {
    expect([...compileCollisionGrid(parseTiledMap(fixture))]).toEqual([0, 1, 0, 0, 0, 1]);
  });

  it('validates production maps, spawns, canopies and reciprocal portals', () => {
    const green = loadMap('greenfields');
    const cave = loadMap('crystal-cave');
    const greenCollision = compileCollisionGrid(green);
    const caveCollision = compileCollisionGrid(cave);
    expect(green.tilesets).toHaveLength(3);
    expect(cave.tilesets).toHaveLength(2);
    expect(greenCollision[4 * green.width + 4]).toBe(0);
    expect(greenCollision[4 * green.width + 6]).toBe(0);
    expect(greenCollision[3 * green.width + 12]).toBe(1);
    expect(greenCollision[2 * green.width + 12]).toBe(0);
    expect(caveCollision[3 * cave.width + 3]).toBe(0);
    expect(extractEmbeddedPortals(green)).toEqual([
      { sourceX: 18, sourceY: 7, destinationMapKey: 'crystal-cave', targetX: 1, targetY: 7 },
    ]);
    expect(extractEmbeddedPortals(cave)).toEqual([
      { sourceX: 1, sourceY: 7, destinationMapKey: 'greenfields', targetX: 17, targetY: 7 },
    ]);
  });

  it('rejects malformed collision data', () => {
    expect(() => parseTiledMap({ ...fixture, layers: [{ name: 'collision', type: 'tilelayer', width: 3, height: 2, data: [0, -1] }] })).toThrow(GameError);
  });
});
