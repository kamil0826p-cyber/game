import { describe, expect, it } from 'vitest';
import type { TiledMapJson } from '../src/modules/maps/tiled-map.types.js';
import { compileCollisionGrid, extractEmbeddedPortals, parseTiledMap } from '../src/modules/maps/tiled-map.parser.js';

const property = (name: string, value: unknown) => ({ name, value });

const source: TiledMapJson = {
  type: 'map',
  orientation: 'orthogonal',
  infinite: false,
  width: 3,
  height: 2,
  tilewidth: 32,
  tileheight: 32,
  tilesets: [
    {
      firstgid: 1,
      tiles: [{ id: 2, properties: [property('collides', true)] }],
    },
  ],
  layers: [
    { name: 'Ground', type: 'tilelayer', width: 3, height: 2, data: [1, 1, 3, 1, 1, 1] },
    {
      name: 'Collisions',
      type: 'objectgroup',
      properties: [property('collision', true)],
      objects: [{ x: 0, y: 32, width: 32, height: 32 }],
    },
    {
      name: 'Portals',
      type: 'objectgroup',
      properties: [property('portals', true)],
      objects: [
        {
          type: 'portal',
          x: 0,
          y: 32,
          width: 32,
          height: 32,
          properties: [
            property('destinationMapKey', 'next-map'),
            property('targetX', 1),
            property('targetY', 1),
          ],
        },
      ],
    },
  ],
};

describe('authoritative Tiled map parser', () => {
  it('accepts finite orthogonal Tiled JSON', () => {
    expect(parseTiledMap(source)).toBe(source);
  });

  it('combines object and tile-property collisions and keeps portal cells walkable', () => {
    const collision = compileCollisionGrid(source);
    expect(collision[2]).toBe(1);
    expect(collision[3]).toBe(0);
  });

  it('extracts portal destinations from object properties', () => {
    expect(extractEmbeddedPortals(source)).toEqual([
      { sourceX: 0, sourceY: 1, destinationMapKey: 'next-map', targetX: 1, targetY: 1 },
    ]);
  });
});
