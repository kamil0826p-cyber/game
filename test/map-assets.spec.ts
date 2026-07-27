import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileCollisionGrid, extractEmbeddedPortals, parseTiledMap } from '../src/modules/maps/tiled-map.parser.js';

const mapNames = ['greenfields', 'crystal-cave'] as const;
const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8')) as unknown;

const tileLayer = (map: ReturnType<typeof parseTiledMap>, name: string) => {
  const layer = map.layers.find((item) => item.type === 'tilelayer' && item.name === name);
  if (!layer || layer.type !== 'tilelayer') throw new Error(`Missing tile layer ${name}.`);
  return layer;
};

const expectWalkable = (collision: Uint8Array, width: number, x: number, y: number) => {
  expect(collision[y * width + x]).toBe(0);
};

describe('committed Tiled map assets', () => {
  for (const mapName of mapNames) {
    it(`${mapName} is large, valid, and synchronized with the browser copy`, async () => {
      const backendPath = resolve('prisma', 'maps', `${mapName}.json`);
      const frontendPath = resolve('frontend', 'public', 'maps', `${mapName}.json`);
      const [backendSource, frontendSource] = await Promise.all([readJson(backendPath), readJson(frontendPath)]);

      expect(frontendSource).toEqual(backendSource);
      const map = parseTiledMap(backendSource);
      expect(map.width).toBe(96);
      expect(map.height).toBe(64);
      for (const layer of map.layers.filter((item) => item.type === 'tilelayer')) {
        expect(layer.width).toBe(map.width);
        expect(layer.height).toBe(map.height);
        expect(layer.data).toHaveLength(map.width * map.height);
      }
      expect(extractEmbeddedPortals(map)).toHaveLength(1);
    });
  }

  it('greenfields keeps tree trunks paired with canopies and spawn areas walkable', async () => {
    const map = parseTiledMap(await readJson(resolve('prisma', 'maps', 'greenfields.json')));
    const trunks = tileLayer(map, 'Tree Trunks');
    const canopies = tileLayer(map, 'Tree Canopies');
    const trunkIndexes = trunks.data.flatMap((gid, index) => gid === 3 ? [index] : []);
    expect(trunkIndexes.length).toBeGreaterThan(120);
    for (const trunkIndex of trunkIndexes) {
      expect(canopies.data[trunkIndex - map.width]).toBe(4);
    }
    const collision = compileCollisionGrid(map);
    expectWalkable(collision, map.width, 9, 7);
    expectWalkable(collision, map.width, 6, 4);
  });

  it('crystal cave has connected trails, substantial formations, and a walkable spawn', async () => {
    const map = parseTiledMap(await readJson(resolve('prisma', 'maps', 'crystal-cave.json')));
    const trails = tileLayer(map, 'Cave Trails');
    const rocks = tileLayer(map, 'Rock Formations');
    expect(trails.data.filter((gid) => gid === 2).length).toBeGreaterThan(1_000);
    expect(rocks.data.filter((gid) => gid === 6).length).toBeGreaterThan(1_500);
    const collision = compileCollisionGrid(map);
    expectWalkable(collision, map.width, 3, 3);
    expectWalkable(collision, map.width, 1, 32);
  });
});
