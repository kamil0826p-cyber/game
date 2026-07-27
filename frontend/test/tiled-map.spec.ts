import { describe, expect, it } from 'vitest';
import type { TiledMapJson } from '../src/contracts/tiled';
import { compileMapDefinition } from '../src/game/map/tiledMap';

const property = (name: string, value: unknown) => ({ name, value });

const createMap = (): TiledMapJson => ({
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
      tilewidth: 32,
      tileheight: 32,
      tilecount: 4,
      columns: 4,
      tiles: [{ id: 2, properties: [property('collides', true)] }],
    },
  ],
  layers: [
    {
      name: 'Ground',
      type: 'tilelayer',
      width: 3,
      height: 2,
      data: [1, 1, 1, 1, 1, 1],
      properties: [property('renderBand', 'below')],
    },
    {
      name: 'Canopies',
      type: 'tilelayer',
      width: 3,
      height: 2,
      data: [0, 4, 0, 0, 0, 0],
      properties: [property('renderBand', 'above')],
    },
    {
      name: 'Rocks',
      type: 'tilelayer',
      width: 3,
      height: 2,
      data: [0, 0, 3, 0, 0, 0],
    },
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
});

describe('Tiled frontend map compiler', () => {
  it('preserves below and above render bands', () => {
    const map = compileMapDefinition('test-map', createMap());
    expect(map.layers.map(({ name, band }) => [name, band])).toEqual([
      ['Ground', 'below'],
      ['Canopies', 'above'],
      ['Rocks', 'below'],
    ]);
  });

  it('combines object and tile-property collisions while keeping portals walkable', () => {
    const map = compileMapDefinition('test-map', createMap());
    expect(map.collision[2]).toBe(1);
    expect(map.collision[3]).toBe(0);
    expect(map.portals).toEqual([
      { sourceX: 0, sourceY: 1, destinationMapKey: 'next-map', targetX: 1, targetY: 1 },
    ]);
  });
});
