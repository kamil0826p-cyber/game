import { gunzipSync, inflateSync } from 'node:zlib';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { EmbeddedPortalDefinition, TiledLayer, TiledMapJson, TiledObject, TiledObjectLayer, TiledProperty, TiledTileLayer } from './tiled-map.types.js';

const invalid = (reason: string): never => {
  throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', { reason });
};
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const hasValidProperties = (value: unknown): value is TiledProperty[] | undefined => value === undefined || (Array.isArray(value) && value.every((property) => isRecord(property) && typeof property.name === 'string' && Object.prototype.hasOwnProperty.call(property, 'value')));
const propertyValue = (properties: TiledProperty[] | undefined, name: string): unknown => properties?.find((property) => property.name === name)?.value;
const isTileLayer = (layer: TiledLayer): layer is TiledTileLayer => isRecord(layer) && layer.type === 'tilelayer';
const isObjectLayer = (layer: TiledLayer): layer is TiledObjectLayer => isRecord(layer) && layer.type === 'objectgroup';
const isPortalLayer = (layer: TiledObjectLayer): boolean => layer.name.toLowerCase() === 'portals' || propertyValue(layer.properties, 'portals') === true;

const decodeLayer = (layer: unknown): unknown => {
  if (!isRecord(layer) || layer.type !== 'tilelayer' || typeof layer.data !== 'string') return layer;
  if (layer.encoding !== 'base64') return invalid(`Tile layer ${String(layer.name ?? '')} uses an unsupported encoding.`);
  const encoded = Buffer.from(layer.data.replace(/\s+/g, ''), 'base64');
  let bytes: Buffer;
  if (layer.compression === undefined || layer.compression === '') bytes = encoded;
  else if (layer.compression === 'zlib') bytes = inflateSync(encoded);
  else if (layer.compression === 'gzip') bytes = gunzipSync(encoded);
  else return invalid(`Tile layer ${String(layer.name ?? '')} uses unsupported compression ${String(layer.compression)}.`);
  if (bytes.byteLength % 4 !== 0) return invalid(`Tile layer ${String(layer.name ?? '')} has invalid binary data.`);
  const data = Array.from({ length: bytes.byteLength / 4 }, (_, index) => bytes.readUInt32LE(index * 4));
  return { ...layer, data };
};

const decodeMapPayload = (input: unknown): unknown => {
  if (!isRecord(input) || !Array.isArray(input.layers)) return input;
  return { ...input, layers: input.layers.map(decodeLayer) };
};

export const parseTiledMap = (input: unknown): TiledMapJson => {
  const decoded = decodeMapPayload(input);
  if (!isRecord(decoded)) return invalid('The Tiled map root must be an object.');
  const { width, height, tilewidth, tileheight, layers, type, orientation, infinite, tilesets } = decoded;
  if (type !== 'map' || orientation !== 'orthogonal' || infinite !== false || !Number.isInteger(width) || !Number.isInteger(height) || !Number.isInteger(tilewidth) || !Number.isInteger(tileheight) || Number(width) <= 0 || Number(height) <= 0 || Number(tilewidth) <= 0 || Number(tileheight) <= 0 || !Array.isArray(layers) || !Array.isArray(tilesets) || !hasValidProperties(decoded.properties)) return invalid('The Tiled map dimensions, tilesets, or layers are invalid.');
  for (const layer of layers) {
    if (!isRecord(layer) || typeof layer.name !== 'string' || typeof layer.type !== 'string' || !hasValidProperties(layer.properties)) return invalid('Every Tiled layer must include string name and type fields.');
    if (layer.type === 'tilelayer' && (!Number.isInteger(layer.width) || !Number.isInteger(layer.height) || !Array.isArray(layer.data) || !layer.data.every((tile) => Number.isInteger(tile) && Number(tile) >= 0))) return invalid(`Tile layer ${layer.name} is malformed.`);
    if (layer.type === 'objectgroup' && (!Array.isArray(layer.objects) || !layer.objects.every((object) => isRecord(object) && (object.x === undefined || typeof object.x === 'number') && (object.y === undefined || typeof object.y === 'number') && (object.width === undefined || typeof object.width === 'number') && (object.height === undefined || typeof object.height === 'number') && hasValidProperties(object.properties)))) return invalid(`Object layer ${layer.name} contains a malformed object.`);
    if (layer.type !== 'tilelayer' && layer.type !== 'objectgroup') return invalid(`Unsupported Tiled layer type: ${layer.type}.`);
  }
  return decoded as unknown as TiledMapJson;
};

const markRectangle = (grid: Uint8Array, map: TiledMapJson, object: TiledObject): void => {
  const left = Math.floor((object.x ?? 0) / map.tilewidth);
  const top = Math.floor((object.y ?? 0) / map.tileheight);
  const right = Math.ceil(((object.x ?? 0) + Math.max(object.width ?? map.tilewidth, 1)) / map.tilewidth);
  const bottom = Math.ceil(((object.y ?? 0) + Math.max(object.height ?? map.tileheight, 1)) / map.tileheight);
  for (let y = Math.max(0, top); y < Math.min(map.height, bottom); y += 1) for (let x = Math.max(0, left); x < Math.min(map.width, right); x += 1) grid[y * map.width + x] = 1;
};

export const compileCollisionGrid = (map: TiledMapJson): Uint8Array => {
  const grid = new Uint8Array(map.width * map.height);
  let collisionSourceCount = 0;
  for (const layer of map.layers) {
    if (isTileLayer(layer) && (layer.name.toLowerCase() === 'collision' || propertyValue(layer.properties, 'collision') === true)) {
      collisionSourceCount += 1;
      if (layer.width !== map.width || layer.height !== map.height || layer.data.length !== grid.length) return invalid(`Collision layer ${layer.name} dimensions do not match the map.`);
      layer.data.forEach((gid, index) => { if (gid !== 0) grid[index] = 1; });
    }
    if (isObjectLayer(layer) && (layer.name.toLowerCase() === 'collisions' || propertyValue(layer.properties, 'collision') === true)) {
      collisionSourceCount += 1;
      layer.objects.forEach((object) => markRectangle(grid, map, object));
    }
  }
  for (const tileset of map.tilesets ?? []) for (const tile of tileset.tiles ?? []) if (propertyValue(tile.properties, 'collides') === true) {
    collisionSourceCount += 1;
    for (const layer of map.layers.filter(isTileLayer)) layer.data.forEach((gid, index) => { if ((gid & 0x1fffffff) === tileset.firstgid + tile.id) grid[index] = 1; });
  }
  if (collisionSourceCount === 0) return invalid('At least one collision tile layer, object layer, or collidable tile property is required.');
  for (const layer of map.layers.filter(isObjectLayer).filter(isPortalLayer)) for (const object of layer.objects) {
    const x = Math.floor((object.x ?? 0) / map.tilewidth);
    const y = Math.floor((object.y ?? 0) / map.tileheight);
    if (x >= 0 && y >= 0 && x < map.width && y < map.height) grid[y * map.width + x] = 0;
  }
  return grid;
};

const integerProperty = (object: TiledObject, name: string, fallback?: number): number => {
  const value = propertyValue(object.properties, name) ?? fallback;
  if (!Number.isInteger(value)) return invalid(`Portal property ${name} must be an integer.`);
  return Number(value);
};
const stringProperty = (object: TiledObject, name: string): string => {
  const value = propertyValue(object.properties, name);
  if (typeof value !== 'string' || !value.trim()) return invalid(`Portal property ${name} must be a non-empty string.`);
  return value;
};

export const extractEmbeddedPortals = (map: TiledMapJson): EmbeddedPortalDefinition[] => map.layers.filter(isObjectLayer).filter(isPortalLayer).flatMap((layer) => layer.objects.filter((object) => !object.type || object.type.toLowerCase() === 'portal').map((object) => ({
  sourceX: integerProperty(object, 'sourceX', Math.floor((object.x ?? 0) / map.tilewidth)),
  sourceY: integerProperty(object, 'sourceY', Math.floor((object.y ?? 0) / map.tileheight)),
  destinationMapKey: stringProperty(object, 'destinationMapKey'),
  targetX: integerProperty(object, 'targetX'),
  targetY: integerProperty(object, 'targetY'),
})));
