import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compileCollisionGrid,
  extractEmbeddedPortals,
  parseTiledMap,
} from '../src/modules/maps/tiled-map.parser.js';
import type { TiledMapJson, TiledTileLayer } from '../src/modules/maps/tiled-map.types.js';

const frontendPath = resolve('frontend', 'public', 'maps', 'hospital.json');
const backendPath = resolve('prisma', 'maps', 'hospital.json');
const GID_MASK = 0x0fffffff;
const FLIPPED_HORIZONTALLY = 0x80000000;

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, 'utf8')) as unknown;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

async function resolveTilesets(raw: unknown, mapPath: string): Promise<TiledMapJson> {
  if (!isRecord(raw) || !Array.isArray(raw.tilesets)) throw new Error('Malformed map.');
  const tilesets = await Promise.all(
    raw.tilesets.map(async (reference) => {
      if (!isRecord(reference) || typeof reference.source !== 'string') return reference;
      const external = await readJson(resolve(dirname(mapPath), reference.source));
      if (!isRecord(external)) throw new Error('Malformed tileset.');
      return { ...external, firstgid: reference.firstgid, source: reference.source };
    }),
  );
  return parseTiledMap({ ...raw, tilesets });
}

const tileLayer = (map: TiledMapJson, name: string): TiledTileLayer => {
  const layer = map.layers.find(
    (candidate): candidate is TiledTileLayer =>
      candidate.type === 'tilelayer' && candidate.name === name,
  );
  if (!layer) throw new Error(`Missing layer ${name}.`);
  return layer;
};

const rawGidAt = (layer: TiledTileLayer, x: number, y: number): number =>
  layer.data[y * layer.width + x] ?? 0;
const gidAt = (layer: TiledTileLayer, x: number, y: number): number =>
  rawGidAt(layer, x, y) & GID_MASK;

const reachable = (
  collision: Uint8Array,
  width: number,
  height: number,
  start: { x: number; y: number },
  target: { x: number; y: number },
): boolean => {
  const queue = [start];
  const seen = new Set<string>();
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    const key = `${current.x},${current.y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (current.x === target.x && current.y === target.y) return true;
    for (const delta of [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ]) {
      const next = { x: current.x + delta.x, y: current.y + delta.y };
      if (
        next.x >= 0 &&
        next.y >= 0 &&
        next.x < width &&
        next.y < height &&
        collision[next.y * width + next.x] === 0
      ) {
        queue.push(next);
      }
    }
  }
  return false;
};

describe('reference-faithful hospital map', () => {
  it('is synchronized, finite and composed from modular hospital tilesets', async () => {
    const [frontend, backend] = await Promise.all([readJson(frontendPath), readJson(backendPath)]);
    expect(frontend).toEqual(backend);
    const map = await resolveTilesets(backend, backendPath);
    expect(map).toMatchObject({
      width: 24,
      height: 18,
      tilewidth: 32,
      tileheight: 32,
      orientation: 'orthogonal',
      infinite: false,
    });
    expect((map.tilesets ?? []).map((tileset) => tileset.source)).toEqual([
      '../assets/tiles/hospital-floor.tsj',
      '../assets/tiles/hospital-structure.tsj',
      '../assets/tiles/hospital-beds.tsj',
      '../assets/tiles/hospital-props.tsj',
    ]);
    expect(tileLayer(map, 'Ground').data.every((gid) => gid !== 0)).toBe(true);
    expect(tileLayer(map, 'Floor Decals')).toBeDefined();
  });

  it('keeps the existing defeat spawn and the lower exit reachable', async () => {
    const map = await resolveTilesets(await readJson(backendPath), backendPath);
    const collision = compileCollisionGrid(map);
    const spawn = { x: 12, y: 9 };
    const [portal] = extractEmbeddedPortals(map);
    expect(portal).toEqual({
      sourceX: 12,
      sourceY: 17,
      destinationMapKey: 'greenfields',
      targetX: 4,
      targetY: 4,
    });
    expect(collision[spawn.y * map.width + spawn.x]).toBe(0);
    expect(collision[portal!.sourceY * map.width + portal!.sourceX]).toBe(0);
    expect(
      reachable(collision, map.width, map.height, spawn, {
        x: portal!.sourceX,
        y: portal!.sourceY,
      }),
    ).toBe(true);
  });

  it('contains exactly eight horizontal multi-tile beds, four on each side', async () => {
    const map = await resolveTilesets(await readJson(backendPath), backendPath);
    const furniture = tileLayer(map, 'Beds and Furniture');
    const rows = [5, 8, 11, 14];

    rows.forEach((y, index) => {
      const start = index % 2 === 0 ? 12 : 15;
      expect([gidAt(furniture, 2, y), gidAt(furniture, 3, y), gidAt(furniture, 4, y)]).toEqual([
        start,
        start + 1,
        start + 2,
      ]);
      expect([gidAt(furniture, 19, y), gidAt(furniture, 20, y), gidAt(furniture, 21, y)]).toEqual([
        start + 2,
        start + 1,
        start,
      ]);
      for (const x of [19, 20, 21]) {
        expect((rawGidAt(furniture, x, y) & FLIPPED_HORIZONTALLY) !== 0).toBe(true);
      }
      expect(gidAt(furniture, 5, y - 1)).toBe(18);
      expect(gidAt(furniture, 18, y - 1)).toBe(18);
    });

    expect(furniture.data.filter((rawGid) => {
      const gid = rawGid & GID_MASK;
      return gid >= 12 && gid <= 17;
    })).toHaveLength(24);
  });

  it('recreates the decorated upper wall, two central stations and lower storage', async () => {
    const map = await resolveTilesets(await readJson(backendPath), backendPath);
    const furniture = tileLayer(map, 'Beds and Furniture');
    const tall = tileLayer(map, 'Tall Props and Door');

    expect([gidAt(furniture, 4, 3), gidAt(furniture, 9, 3), gidAt(furniture, 14, 3)]).toEqual([
      19,
      29,
      19,
    ]);
    expect(gidAt(furniture, 17, 3)).toBe(27);
    expect([gidAt(tall, 2, 2), gidAt(tall, 7, 2), gidAt(tall, 12, 2)]).toEqual([
      31,
      32,
      33,
    ]);
    expect([gidAt(furniture, 10, 10), gidAt(furniture, 10, 14)]).toEqual([28, 30]);
    expect([gidAt(furniture, 2, 16), gidAt(furniture, 16, 16), gidAt(furniture, 18, 16)]).toEqual([
      34,
      25,
      26,
    ]);
    expect([gidAt(tall, 6, 16), gidAt(tall, 7, 16)]).toEqual([20, 21]);
    expect(gidAt(tall, 23, 9)).toBe(10);
    expect(gidAt(tall, 12, 17)).toBe(11);
  });

  it('keeps every bedside aisle and the lower half connected to the spawn', async () => {
    const map = await resolveTilesets(await readJson(backendPath), backendPath);
    const collision = compileCollisionGrid(map);
    const spawn = { x: 12, y: 9 };
    const targets = [
      ...[5, 8, 11, 14].flatMap((y) => [
        { x: 6, y },
        { x: 17, y },
      ]),
      { x: 14, y: 10 },
      { x: 14, y: 13 },
      { x: 13, y: 15 },
      { x: 12, y: 16 },
      { x: 9, y: 16 },
      { x: 12, y: 17 },
    ];

    for (const target of targets) {
      expect(collision[target.y * map.width + target.x], `expected walkable at ${target.x},${target.y}`).toBe(0);
      expect(reachable(collision, map.width, map.height, spawn, target)).toBe(true);
    }
  });

  it('blocks the perimeter outside the lower portal and the decorative side door', async () => {
    const map = await resolveTilesets(await readJson(backendPath), backendPath);
    const collision = compileCollisionGrid(map);

    for (let x = 0; x < map.width; x += 1) {
      expect(collision[x]).toBe(1);
      if (x !== 12) expect(collision[(map.height - 1) * map.width + x]).toBe(1);
    }
    for (let y = 0; y < map.height; y += 1) {
      expect(collision[y * map.width]).toBe(1);
      expect(collision[y * map.width + map.width - 1]).toBe(1);
    }
    expect(collision[9 * map.width + 23]).toBe(1);
    expect(collision[17 * map.width + 12]).toBe(0);
  });
});
