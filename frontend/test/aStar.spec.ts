import { describe, expect, it } from 'vitest';
import type { LoadedMapDefinition, TiledMapJson } from '../src/contracts/tiled';
import { findPath } from '../src/game/pathfinding/aStar';

const map = (collision: number[], width = 5, height = 5): LoadedMapDefinition => ({
  key: 'test',
  source: {
    type: 'map',
    orientation: 'orthogonal',
    infinite: false,
    width,
    height,
    tilewidth: 32,
    tileheight: 32,
    layers: [],
  } satisfies TiledMapJson,
  width,
  height,
  tileWidth: 32,
  tileHeight: 32,
  ground: new Array<number>(width * height).fill(1),
  collision: Uint8Array.from(collision),
  portals: [],
});

describe('findPath', () => {
  it('finds a cardinal path around collision tiles', () => {
    const collision = new Array<number>(25).fill(0);
    collision[1 * 5 + 2] = 1;
    collision[2 * 5 + 2] = 1;
    collision[3 * 5 + 2] = 1;

    const path = findPath(map(collision), { x: 1, y: 2 }, { x: 3, y: 2 });

    expect(path.length).toBe(6);
    expect(path.at(-1)).toEqual({ x: 3, y: 2 });
    expect(path.some((step) => step.x === 2 && step.y === 2)).toBe(false);
  });

  it('rejects a collision target', () => {
    const collision = new Array<number>(25).fill(0);
    collision[4] = 1;
    expect(findPath(map(collision), { x: 0, y: 0 }, { x: 4, y: 0 })).toEqual([]);
  });

  it('honors dynamic blockers', () => {
    const collision = new Array<number>(25).fill(0);
    const path = findPath(map(collision), { x: 0, y: 0 }, { x: 2, y: 0 }, {
      isDynamicallyBlocked: (x, y) => x === 1 && y === 0,
    });
    expect(path).toEqual([
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 0 },
    ]);
  });
});
