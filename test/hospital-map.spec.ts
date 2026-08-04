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

const gidAt = (layer: TiledTileLayer, x: number, y: number): number =>
  layer.data[y * layer.width + x] ?? 0;

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

describe('dark hospital map', () => {
  it('is synchronized, finite and composed from the hospital tilesets', async () => {
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
  });

  it('keeps the defeat spawn walkable and connected to the Greenfields portal', async () => {
    const map = await resolveTilesets(await readJson(backendPath), backendPath);
    const collision = compileCollisionGrid(map);
    const spawn = { x: 12, y: 15 };
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

  it('uses a deliberate two-ward layout without ambiguous bedside clutter', async () => {
    const map = await resolveTilesets(await readJson(backendPath), backendPath);
    const ground = tileLayer(map, 'Ground');
    const furniture = tileLayer(map, 'Beds and Furniture');
    const tall = tileLayer(map, 'Tall Props and Door');

    const expectedBeds = [
      { x: 4, top: 4 },
      { x: 19, top: 4 },
      { x: 4, top: 10 },
      { x: 19, top: 10 },
    ];
    for (const bed of expectedBeds) {
      expect([
        gidAt(furniture, bed.x, bed.top),
        gidAt(furniture, bed.x, bed.top + 1),
        gidAt(furniture, bed.x, bed.top + 2),
      ]).toEqual([11, 12, 13]);
    }
    expect(furniture.data.filter((gid) => gid >= 11 && gid <= 16)).toHaveLength(12);

    const intentionallyUnusedProps = new Set([17, 19, 20, 21, 23]);
    expect(
      [...furniture.data, ...tall.data].filter((gid) => intentionallyUnusedProps.has(gid)),
    ).toHaveLength(0);

    expect(tall.data.filter((gid) => gid === 18)).toHaveLength(2);
    expect(gidAt(tall, 11, 2)).toBe(18);
    expect(gidAt(tall, 12, 2)).toBe(18);

    const braziers = [
      { x: 2, y: 2 },
      { x: 21, y: 2 },
      { x: 2, y: 14 },
      { x: 21, y: 14 },
    ];
    expect(furniture.data.filter((gid) => gid === 22)).toHaveLength(braziers.length);
    for (const position of braziers) {
      expect(gidAt(furniture, position.x, position.y)).toBe(22);
    }

    expect([
      gidAt(furniture, 2, 15),
      gidAt(furniture, 3, 15),
      gidAt(furniture, 4, 15),
      gidAt(furniture, 19, 15),
      gidAt(furniture, 20, 15),
      gidAt(furniture, 21, 15),
    ]).toEqual([24, 24, 25, 25, 24, 24]);

    expect(ground.data.filter((gid) => gid === 5)).toHaveLength(1);
    expect(gidAt(ground, 12, 8)).toBe(5);
    expect(new Set(ground.data)).toEqual(new Set([1, 2, 5]));
  });

  it('blocks the perimeter outside the portal', async () => {
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
  });
});
