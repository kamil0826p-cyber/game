import { describe, expect, it } from 'vitest';
import type { TiledMapJson } from '../src/modules/maps/tiled-map.types.js';
import { compileCollisionGrid, extractEmbeddedPortals, parseTiledMap } from '../src/modules/maps/tiled-map.parser.js';

const property = (name: string, value: unknown) => ({ name, value });

const source: TiledMapJson = {
  type: 'map', orientation: 'orthogonal', renderorder: 'right-down', infinite: false,
  width: 5, height: 4, tilewidth: 32, tileheight: 32,
  tilesets: [{
    firstgid: 1, name: 'world', tilewidth: 32, tileheight: 32, tilecount: 3, columns: 3,
    tiles: [{ id: 1, objectgroup: { name: 'Footprint', type: 'objectgroup', objects: [{ x: -32, y: -32, width: 96, height: 64 }] } }],
  }],
  layers: [
    {
      name: 'World', type: 'group', offsetx: 32,
      layers: [{ name: 'Large Props', type: 'tilelayer', width: 2, height: 2, offsety: 32, data: [0, 0, 0, (0x90000002) >>> 0] }],
    },
    { name: 'Collisions', type: 'objectgroup', properties: [property('collision', true)], objects: [{ x: 0, y: 0, width: 32, height: 32 }] },
    {
      name: 'Portals', type: 'objectgroup', properties: [property('portals', true)],
      objects: [{ type: 'portal', x: 0, y: 0, width: 32, height: 32, properties: [property('destinationMapKey', 'next-map'), property('targetX', 1), property('targetY', 1)] }],
    },
  ],
};

describe('authoritative Tiled map parser', () => {
  it('accepts groups, offsets, and generic tile collision objects', () => {
    const collision = compileCollisionGrid(parseTiledMap(source));
    for (const y of [1, 2]) for (const x of [1, 2, 3]) expect(collision[y * source.width + x]).toBe(1);
    expect(collision[0]).toBe(0);
  });

  it('extracts portals through nested Tiled metadata rules', () => {
    expect(extractEmbeddedPortals(parseTiledMap(source))).toEqual([
      { sourceX: 0, sourceY: 0, destinationMapKey: 'next-map', targetX: 1, targetY: 1 },
    ]);
  });

  it('fails fast when layer data length is invalid', () => {
    expect(() => parseTiledMap({ ...source, layers: [{ name: 'Broken', type: 'tilelayer', width: 2, height: 2, data: [1] }] })).toThrow();
  });
});
