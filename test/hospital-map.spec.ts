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

  it('respawns the player in the center and keeps the portal reachable', async () => {
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

  it('uses the new bed tileset and denser, readable furnishing layout', async () => {
    const map = await resolveTilesets(await readJson(backendPath), backendPath);
    const furniture = tileLayer(map, 'Beds and Furniture');
    const tall = tileLayer(map, 'Tall Props and Door');

    const expectedBeds = [
      { x: 4, top: 4 },
      { x: 18, top: 4 },
      { x: 4, top: 10 },
      { x: 18, top: 10 },
    ];
    for (const bed of expectedBeds) {
      expect([
        gidAt(furniture, bed.x, bed.top),
        gidAt(furniture, bed.x, bed.top + 1),
        gidAt(furniture, bed.x, bed.top + 2),
      ]).toEqual([11, 12, 13]);
    }
    expect(furniture.data.filter((gid) => gid >= 11 && gid <= 16)).toHaveLength(12);

    const bedsideCabinets = [
      [6, 5],
      [6, 11],
      [16, 5],
      [16, 11],
      [3, 5],
      [3, 11],
      [19, 5],
      [19, 11],
    ];
    for (const [x, y] of bedsideCabinets) expect(gidAt(furniture, x!, y!)).toBe(17);

    expect([gidAt(tall, 11, 2), gidAt(tall, 12, 2)]).toEqual([18, 18]);
    expect([
      gidAt(tall, 10, 2),
      gidAt(tall, 13, 2),
      gidAt(tall, 8, 2),
      gidAt(tall, 15, 2),
    ]).toEqual([26, 26, 26, 26]);
    expect([gidAt(furniture, 9, 2), gidAt(furniture, 14, 2)]).toEqual([27, 27]);
    expect([
      gidAt(furniture, 2, 7),
      gidAt(furniture, 2, 9),
      gidAt(furniture, 21, 7),
      gidAt(furniture, 21, 9),
    ]).toEqual([28, 28, 28, 28]);
  });

  it('does not block empty central walkways or bedside aisles', async () => {
    const map = await resolveTilesets(await readJson(backendPath), backendPath);
    const collision = compileCollisionGrid(map);
    const walkable = [
      [12, 9],
      [12, 8],
      [12, 10],
      [11, 9],
      [13, 9],
      [12, 15],
      [12, 16],
      [11, 16],
      [13, 16],
      [5, 5],
      [17, 5],
      [5, 11],
      [17, 11],
      [7, 5],
      [15, 5],
      [7, 11],
      [15, 11],
      [10, 9],
      [14, 9],
      [9, 8],
      [15, 8],
    ];
    for (const [x, y] of walkable) {
      expect(collision[y! * map.width + x!], `expected walkable at ${x},${y}`).toBe(0);
    }
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
