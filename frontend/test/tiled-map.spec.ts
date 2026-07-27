import { describe, expect, it } from 'vitest';
import type { TiledMapJson } from '../src/contracts/tiled';
import {
  compileMapDefinition,
  normalizedGid,
  TILED_FLIPPED_HORIZONTALLY_FLAG,
  TILED_ROTATED_HEXAGONAL_120_FLAG,
} from '../src/game/map/tiledMap';

const property = (name: string, value: unknown) => ({ name, value });

const createMap = (): TiledMapJson => ({
  type: 'map',
  orientation: 'orthogonal',
  renderorder: 'left-up',
  infinite: false,
  width: 5,
  height: 4,
  tilewidth: 32,
  tileheight: 32,
  tilesets: [{
    firstgid: 1,
    name: 'world',
    image: '../assets/world.png',
    imagewidth: 96,
    imageheight: 32,
    tilewidth: 32,
    tileheight: 32,
    tilecount: 3,
    columns: 3,
    tiles: [{
      id: 1,
      properties: [
        property('renderWidthTiles', 3),
        property('renderHeightTiles', 2),
        property('renderAnchorX', 0.5),
        property('renderAnchorY', 1),
        property('renderOffsetXTiles', 0.5),
        property('renderOffsetYTiles', 1),
      ],
      objectgroup: { name: 'Footprint', type: 'objectgroup', objects: [{ x: -32, y: -32, width: 96, height: 64 }] },
    }],
  }],
  layers: [
    {
      name: 'World',
      type: 'group',
      opacity: 0.5,
      offsetx: 32,
      properties: [property('renderBand', 'above')],
      layers: [{
        name: 'Large Props',
        type: 'tilelayer',
        width: 2,
        height: 2,
        offsety: 32,
        data: [0, 0, 0, (TILED_ROTATED_HEXAGONAL_120_FLAG | TILED_FLIPPED_HORIZONTALLY_FLAG | 2) >>> 0],
      }],
    },
    { name: 'Collisions', type: 'objectgroup', properties: [property('collision', true)], objects: [{ x: 0, y: 0, width: 32, height: 32 }] },
    {
      name: 'Portals',
      type: 'objectgroup',
      properties: [property('portals', true)],
      objects: [{
        type: 'portal', x: 0, y: 0, width: 32, height: 32,
        properties: [property('destinationMapKey', 'next-map'), property('targetX', 1), property('targetY', 1)],
      }],
    },
  ],
});

describe('Tiled frontend map compiler', () => {
  it('preserves nested layer order, offsets, opacity, and render bands', () => {
    const map = compileMapDefinition('test-map', createMap());
    expect(map.layers).toEqual([
      expect.objectContaining({ name: 'Large Props', band: 'above', opacity: 0.5, width: 2, height: 2, offsetX: 32, offsetY: 32 }),
    ]);
  });

  it('uses generic tileset render metadata instead of asset-specific exceptions', () => {
    const map = compileMapDefinition('test-map', createMap());
    expect(map.tileRenderDefinitions.get(2)).toEqual({ widthTiles: 3, heightTiles: 2, anchorX: 0.5, anchorY: 1, offsetXTiles: 0.5, offsetYTiles: 1 });
  });

  it('compiles tile collision objects and keeps the full portal rectangle walkable', () => {
    const map = compileMapDefinition('test-map', createMap());
    for (const y of [1, 2]) for (const x of [1, 2, 3]) expect(map.collision[y * map.width + x]).toBe(1);
    expect(map.collision[0]).toBe(0);
    expect(map.portals).toEqual([{ sourceX: 0, sourceY: 0, destinationMapKey: 'next-map', targetX: 1, targetY: 1 }]);
  });

  it('aligns collision objects to the full tile image and tileoffset', () => {
    const source: TiledMapJson = {
      type: 'map', orientation: 'orthogonal', infinite: false, width: 3, height: 3, tilewidth: 32, tileheight: 32,
      tilesets: [{
        firstgid: 1, name: 'canopy-sized-object', tilewidth: 32, tileheight: 32, tileoffset: { x: -42, y: -26 },
        tiles: [{ id: 0, imagewidth: 116, imageheight: 109, objectgroup: { name: 'Collision', type: 'objectgroup', objects: [{ x: 42, y: 103, width: 32, height: 32 }] } }],
      }],
      layers: [
        { name: 'Props', type: 'tilelayer', width: 3, height: 3, data: [0, 0, 0, 0, 1, 0, 0, 0, 0] },
        { name: 'Collisions', type: 'objectgroup', properties: [property('collision', true)], objects: [] },
      ],
    };
    const map = compileMapDefinition('offset-map', source);
    expect(map.collision[1 * map.width + 1]).toBe(1);
    expect(map.collision[2 * map.width + 1]).toBe(0);
  });

  it('clears every Tiled flip and rotation flag before resolving a tile', () => {
    expect(normalizedGid((TILED_ROTATED_HEXAGONAL_120_FLAG | TILED_FLIPPED_HORIZONTALLY_FLAG | 2) >>> 0)).toBe(2);
  });
});
