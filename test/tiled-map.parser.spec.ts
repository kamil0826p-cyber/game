import { describe, expect, it } from 'vitest';
import { GameError } from '../src/common/errors/game.error.js';
import {
  compileCollisionGrid,
  extractEmbeddedPortals,
  parseTiledMap,
} from '../src/modules/maps/tiled-map.parser.js';

const validMap = {
  type: 'map',
  orientation: 'orthogonal',
  infinite: false,
  width: 3,
  height: 2,
  tilewidth: 32,
  tileheight: 32,
  tilesets: [],
  layers: [
    {
      name: 'ground',
      type: 'tilelayer',
      width: 3,
      height: 2,
      data: [1, 1, 1, 1, 1, 1],
    },
    {
      name: 'collision',
      type: 'tilelayer',
      width: 3,
      height: 2,
      data: [0, 1, 0, 0, 0, 2],
    },
    {
      name: 'portals',
      type: 'objectgroup',
      objects: [
        {
          type: 'portal',
          x: 64,
          y: 32,
          properties: [
            { name: 'destinationMapKey', type: 'string', value: 'cave' },
            { name: 'targetX', type: 'int', value: 4 },
            { name: 'targetY', type: 'int', value: 5 },
          ],
        },
      ],
    },
  ],
} as const;

describe('Tiled map parsing', () => {
  it('compiles collision tiles and keeps portal rectangles walkable', () => {
    const parsed = parseTiledMap(validMap);
    expect([...compileCollisionGrid(parsed)]).toEqual([0, 1, 0, 0, 0, 0]);
  });

  it('extracts portal coordinates and destination properties', () => {
    const portals = extractEmbeddedPortals(parseTiledMap(validMap));
    expect(portals).toEqual([
      {
        sourceX: 2,
        sourceY: 1,
        destinationMapKey: 'cave',
        targetX: 4,
        targetY: 5,
      },
    ]);
  });

  it('rejects malformed tile-layer data before runtime compilation', () => {
    expect(() =>
      parseTiledMap({
        ...validMap,
        layers: [{ name: 'collision', type: 'tilelayer', width: 3, height: 2, data: [0, -1] }],
      }),
    ).toThrow(GameError);
  });

  it('rejects malformed object-layer entries before portal extraction', () => {
    expect(() =>
      parseTiledMap({
        ...validMap,
        layers: [
          validMap.layers[0],
          {
            name: 'portals',
            type: 'objectgroup',
            objects: [{ type: 'portal', x: '64', y: 32 }],
          },
        ],
      }),
    ).toThrow(GameError);
  });

  it('rejects malformed property collections', () => {
    expect(() =>
      parseTiledMap({
        ...validMap,
        properties: [{ name: 123, value: true }],
      }),
    ).toThrow(GameError);
  });

  it('requires a collision layer', () => {
    const parsed = parseTiledMap({ ...validMap, layers: [validMap.layers[0]] });
    expect(() => compileCollisionGrid(parsed)).toThrow(GameError);
  });
});
