import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type {
  EmbeddedPortalDefinition,
  TiledLayer,
  TiledMapJson,
  TiledObject,
  TiledObjectLayer,
  TiledProperty,
  TiledTileLayer,
} from './tiled-map.types.js';

const FLIP_MASK = 0x1fffffff;

const invalid = (reason: string): never => {
  throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', { reason });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const propertiesValid = (value: unknown): value is TiledProperty[] | undefined =>
  value === undefined ||
  (Array.isArray(value) &&
    value.every(
      (property) =>
        isRecord(property) &&
        typeof property.name === 'string' &&
        Object.prototype.hasOwnProperty.call(property, 'value'),
    ));

const propertyValue = (properties: TiledProperty[] | undefined, name: string): unknown =>
  properties?.find((property) => property.name === name)?.value;

const boolProperty = (properties: TiledProperty[] | undefined, name: string): boolean =>
  propertyValue(properties, name) === true;

const flattenLayers = (
  layers: readonly TiledLayer[],
  offsetX = 0,
  offsetY = 0,
): Array<{ layer: TiledTileLayer | TiledObjectLayer; offsetX: number; offsetY: number }> => {
  const flattened: Array<{ layer: TiledTileLayer | TiledObjectLayer; offsetX: number; offsetY: number }> = [];
  for (const layer of layers) {
    const nextX = offsetX + (layer.offsetx ?? 0);
    const nextY = offsetY + (layer.offsety ?? 0);
    if (layer.type === 'group') flattened.push(...flattenLayers(layer.layers, nextX, nextY));
    else flattened.push({ layer, offsetX: nextX, offsetY: nextY });
  }
  return flattened;
};

const validateLayers = (layers: unknown[]): void => {
  for (const rawLayer of layers) {
    if (!isRecord(rawLayer) || typeof rawLayer.name !== 'string' || typeof rawLayer.type !== 'string' || !propertiesValid(rawLayer.properties)) {
      invalid('Every Tiled layer must include valid name, type, and properties fields.');
    }
    if (rawLayer.type === 'group') {
      if (!Array.isArray(rawLayer.layers)) invalid(`Group layer ${rawLayer.name} must contain layers.`);
      validateLayers(rawLayer.layers as unknown[]);
    } else if (rawLayer.type === 'tilelayer') {
      const hasData = Array.isArray(rawLayer.data);
      const hasChunks = Array.isArray(rawLayer.chunks);
      if (!hasData && !hasChunks) invalid(`Tile layer ${rawLayer.name} must contain data or chunks.`);
    } else if (rawLayer.type === 'objectgroup') {
      if (!Array.isArray(rawLayer.objects)) invalid(`Object layer ${rawLayer.name} must contain objects.`);
    } else invalid(`Unsupported Tiled layer type: ${rawLayer.type}.`);
  }
};

export const parseTiledMap = (input: unknown): TiledMapJson => {
  if (!isRecord(input)) invalid('The Tiled map root must be an object.');
  const { width, height, tilewidth, tileheight, layers, type } = input;
  if (
    type !== 'map' ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    !Number.isInteger(tilewidth) ||
    !Number.isInteger(tileheight) ||
    Number(width) <= 0 ||
    Number(height) <= 0 ||
    Number(tilewidth) <= 0 ||
    Number(tileheight) <= 0 ||
    !Array.isArray(layers) ||
    !propertiesValid(input.properties)
  ) invalid('The Tiled map dimensions or layer collection are invalid.');
  validateLayers(layers);
  return input as unknown as TiledMapJson;
};

const layerData = (map: TiledMapJson, layer: TiledTileLayer): number[] => {
  const tileCount = map.width * map.height;
  if (layer.data) {
    if (layer.width !== map.width || layer.height !== map.height || layer.data.length !== tileCount) {
      invalid(`Collision layer ${layer.name} dimensions do not match the map.`);
    }
    return layer.data.map((gid) => gid & FLIP_MASK);
  }
  const data = new Array<number>(tileCount).fill(0);
  for (const chunk of layer.chunks ?? []) {
    if (chunk.data.length !== chunk.width * chunk.height) invalid(`Chunk in ${layer.name} is malformed.`);
    chunk.data.forEach((gid, index) => {
      const x = chunk.x + (index % chunk.width);
      const y = chunk.y + Math.floor(index / chunk.width);
      if (x >= 0 && y >= 0 && x < map.width && y < map.height) data[y * map.width + x] = gid & FLIP_MASK;
    });
  }
  return data;
};

const markRectangle = (
  grid: Uint8Array,
  map: TiledMapJson,
  x: number,
  y: number,
  width: number,
  height: number,
): void => {
  const left = Math.floor(x / map.tilewidth);
  const top = Math.floor(y / map.tileheight);
  const right = Math.ceil((x + Math.max(width, 1)) / map.tilewidth);
  const bottom = Math.ceil((y + Math.max(height, 1)) / map.tileheight);
  for (let tileY = top; tileY < bottom; tileY += 1) {
    for (let tileX = left; tileX < right; tileX += 1) {
      if (tileX >= 0 && tileY >= 0 && tileX < map.width && tileY < map.height) {
        grid[tileY * map.width + tileX] = 1;
      }
    }
  }
};

export const compileCollisionGrid = (map: TiledMapJson): Uint8Array => {
  const grid = new Uint8Array(map.width * map.height);
  let collisionSources = 0;
  for (const { layer, offsetX, offsetY } of flattenLayers(map.layers)) {
    const normalized = layer.name.toLowerCase();
    const collision = normalized === 'collision' || normalized === 'obstacles' || boolProperty(layer.properties, 'collision');
    if (!collision) continue;
    collisionSources += 1;
    if (layer.type === 'tilelayer') {
      layerData(map, layer).forEach((gid, index) => {
        if (gid !== 0) grid[index] = 1;
      });
    } else {
      for (const object of layer.objects) {
        markRectangle(
          grid,
          map,
          (object.x ?? 0) + offsetX,
          (object.y ?? 0) + offsetY,
          object.width ?? 1,
          object.height ?? 1,
        );
      }
    }
  }
  if (collisionSources === 0) invalid('At least one collision tile or object layer is required.');
  return grid;
};

const integerProperty = (object: TiledObject, name: string, fallback?: number): number => {
  const value = propertyValue(object.properties, name) ?? fallback;
  if (!Number.isInteger(value)) invalid(`Portal property ${name} must be an integer.`);
  return Number(value);
};

const stringProperty = (object: TiledObject, name: string): string => {
  const value = propertyValue(object.properties, name);
  if (typeof value !== 'string' || value.trim() === '') invalid(`Portal property ${name} must be a non-empty string.`);
  return value;
};

export const extractEmbeddedPortals = (map: TiledMapJson): EmbeddedPortalDefinition[] => {
  const portals: EmbeddedPortalDefinition[] = [];
  for (const { layer, offsetX, offsetY } of flattenLayers(map.layers)) {
    if (
      layer.type !== 'objectgroup' ||
      (layer.name.toLowerCase() !== 'portals' && !boolProperty(layer.properties, 'portals'))
    ) continue;
    for (const object of layer.objects) {
      if ((object.class ?? object.type)?.toLowerCase() !== 'portal') continue;
      portals.push({
        sourceX: integerProperty(object, 'sourceX', Math.floor(((object.x ?? 0) + offsetX) / map.tilewidth)),
        sourceY: integerProperty(object, 'sourceY', Math.floor(((object.y ?? 0) + offsetY) / map.tileheight)),
        destinationMapKey: stringProperty(object, 'destinationMapKey'),
        targetX: integerProperty(object, 'targetX'),
        targetY: integerProperty(object, 'targetY'),
      });
    }
  }
  return portals;
};
