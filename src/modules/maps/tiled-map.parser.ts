import { gunzipSync, inflateSync } from 'node:zlib';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { EmbeddedPortalDefinition, TiledGroupLayer, TiledLayer, TiledMapJson, TiledObject, TiledObjectLayer, TiledProperty, TiledTileLayer, TiledTilesetReference } from './tiled-map.types.js';

const GID_MASK = 0x0fffffff;
const invalid = (reason: string): never => { throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', { reason }); };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const normalizedName = (value: string): string => value.trim().toLowerCase();
const validProperties = (value: unknown): value is TiledProperty[] | undefined => value === undefined || (Array.isArray(value) && value.every((property) => isRecord(property) && typeof property.name === 'string' && Object.hasOwn(property, 'value')));
const propertyValue = (properties: TiledProperty[] | undefined, name: string): unknown => properties?.find((property) => normalizedName(property.name) === normalizedName(name))?.value;
const isTileLayer = (layer: TiledLayer): layer is TiledTileLayer => layer.type === 'tilelayer';
const isObjectLayer = (layer: TiledLayer): layer is TiledObjectLayer => layer.type === 'objectgroup';
const isGroupLayer = (layer: TiledLayer): layer is TiledGroupLayer => layer.type === 'group';
const normalizedGid = (gid: number): number => gid & GID_MASK;

const decodeLayer = (layer: unknown): unknown => {
  if (!isRecord(layer)) return layer;
  if (layer.type === 'group' && Array.isArray(layer.layers)) return { ...layer, layers: layer.layers.map(decodeLayer) };
  if (layer.type !== 'tilelayer' || typeof layer.data !== 'string') return layer;
  if (layer.encoding === 'csv') return { ...layer, data: layer.data.split(',').map((value) => Number(value.trim())) };
  if (layer.encoding !== 'base64') return invalid(`Tile layer ${String(layer.name ?? '')} uses an unsupported encoding.`);
  const encoded = Buffer.from(layer.data.replace(/\s+/g, ''), 'base64');
  const bytes = layer.compression === undefined || layer.compression === '' ? encoded : layer.compression === 'zlib' ? inflateSync(encoded) : layer.compression === 'gzip' ? gunzipSync(encoded) : invalid(`Tile layer ${String(layer.name ?? '')} uses unsupported compression ${String(layer.compression)}.`);
  if (bytes.byteLength % 4 !== 0) return invalid(`Tile layer ${String(layer.name ?? '')} has invalid binary data.`);
  return { ...layer, data: Array.from({ length: bytes.byteLength / 4 }, (_, index) => bytes.readUInt32LE(index * 4)) };
};

const validateLayer = (layer: unknown): void => {
  if (!isRecord(layer) || typeof layer.name !== 'string' || typeof layer.type !== 'string' || !validProperties(layer.properties)) return invalid('Every Tiled layer must include a valid name, type, and properties.');
  if (layer.type === 'tilelayer') {
    if (!Number.isInteger(layer.width) || !Number.isInteger(layer.height) || Number(layer.width) <= 0 || Number(layer.height) <= 0 || !Array.isArray(layer.data) || !layer.data.every((gid) => Number.isInteger(gid) && Number(gid) >= 0) || layer.data.length !== Number(layer.width) * Number(layer.height)) return invalid(`Tile layer ${layer.name} is malformed.`);
    return;
  }
  if (layer.type === 'objectgroup') {
    if (!Array.isArray(layer.objects) || !layer.objects.every((object) => isRecord(object) && validProperties(object.properties))) return invalid(`Object layer ${layer.name} is malformed.`);
    return;
  }
  if (layer.type === 'group') {
    if (!Array.isArray(layer.layers)) return invalid(`Group layer ${layer.name} is malformed.`);
    layer.layers.forEach(validateLayer);
    return;
  }
  return invalid(`Unsupported Tiled layer type: ${layer.type}.`);
};

export const parseTiledMap = (input: unknown): TiledMapJson => {
  const decoded = isRecord(input) && Array.isArray(input.layers) ? { ...input, layers: input.layers.map(decodeLayer) } : input;
  if (!isRecord(decoded)) return invalid('The Tiled map root must be an object.');
  const { type, orientation, infinite, width, height, tilewidth, tileheight, layers, tilesets } = decoded;
  if (type !== 'map' || orientation !== 'orthogonal' || infinite !== false || !Number.isInteger(width) || !Number.isInteger(height) || !Number.isInteger(tilewidth) || !Number.isInteger(tileheight) || Number(width) <= 0 || Number(height) <= 0 || Number(tilewidth) <= 0 || Number(tileheight) <= 0 || !Array.isArray(layers) || !Array.isArray(tilesets)) return invalid('The Tiled map must be finite, orthogonal, and have positive dimensions.');
  layers.forEach(validateLayer);
  return decoded as unknown as TiledMapJson;
};

interface Context { visible: boolean; offsetX: number; offsetY: number }
const childContext = (map: TiledMapJson, layer: TiledLayer, parent: Context): Context => ({ visible: parent.visible && layer.visible !== false, offsetX: parent.offsetX + (layer.offsetx ?? 0) + (layer.x ?? 0) * map.tilewidth, offsetY: parent.offsetY + (layer.offsety ?? 0) + (layer.y ?? 0) * map.tileheight });
const walkLayers = (map: TiledMapJson, visit: (layer: TiledLayer, context: Context) => void): void => {
  const walk = (layers: TiledLayer[], parent: Context): void => {
    for (const layer of layers) {
      const context = childContext(map, layer, parent);
      if (isGroupLayer(layer)) walk(layer.layers, context); else visit(layer, context);
    }
  };
  walk(map.layers, { visible: true, offsetX: 0, offsetY: 0 });
};

interface Bounds { left: number; top: number; right: number; bottom: number }
const objectBounds = (object: TiledObject, originX: number, originY: number, defaultWidth: number, defaultHeight: number): Bounds => {
  const x = originX + (object.x ?? 0);
  const y = originY + (object.y ?? 0);
  const width = Math.max(object.width ?? defaultWidth, 1);
  const height = Math.max(object.height ?? defaultHeight, 1);
  const points = object.polygon ?? object.polyline ?? [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
  const angle = ((object.rotation ?? 0) * Math.PI) / 180;
  const transformed = points.map((point) => ({ x: x + point.x * Math.cos(angle) - point.y * Math.sin(angle), y: y + point.x * Math.sin(angle) + point.y * Math.cos(angle) }));
  return { left: Math.min(...transformed.map((point) => point.x)), top: Math.min(...transformed.map((point) => point.y)), right: Math.max(...transformed.map((point) => point.x)), bottom: Math.max(...transformed.map((point) => point.y)) };
};
const paint = (grid: Uint8Array, map: TiledMapJson, bounds: Bounds, value: 0 | 1): void => {
  const left = Math.floor(bounds.left / map.tilewidth);
  const top = Math.floor(bounds.top / map.tileheight);
  const right = Math.max(left + 1, Math.ceil(bounds.right / map.tilewidth));
  const bottom = Math.max(top + 1, Math.ceil(bounds.bottom / map.tileheight));
  for (let y = Math.max(0, top); y < Math.min(map.height, bottom); y += 1) for (let x = Math.max(0, left); x < Math.min(map.width, right); x += 1) grid[y * map.width + x] = value;
};

interface TileCollisionDefinition {
  tile: NonNullable<NonNullable<TiledMapJson['tilesets']>[number]['tiles']>[number];
  tileset: TiledTilesetReference;
}

const tileCollisionOrigin = (map: TiledMapJson, definition: TileCollisionDefinition, cellX: number, cellY: number): { x: number; y: number; width: number; height: number } => {
  const width = definition.tile.imagewidth ?? definition.tileset.tilewidth ?? map.tilewidth;
  const height = definition.tile.imageheight ?? definition.tileset.tileheight ?? map.tileheight;
  return {
    x: cellX + (definition.tileset.tileoffset?.x ?? 0),
    y: cellY + map.tileheight - height + (definition.tileset.tileoffset?.y ?? 0),
    width,
    height,
  };
};

export const compileCollisionGrid = (map: TiledMapJson): Uint8Array => {
  const grid = new Uint8Array(map.width * map.height);
  const tileDefinitions = new Map<number, TileCollisionDefinition>();
  for (const tileset of map.tilesets ?? []) for (const tile of tileset.tiles ?? []) tileDefinitions.set(tileset.firstgid + tile.id, { tile, tileset });
  let sources = 0;
  walkLayers(map, (layer, context) => {
    if (isObjectLayer(layer) && (normalizedName(layer.name) === 'collisions' || propertyValue(layer.properties, 'collision') === true)) {
      sources += 1;
      for (const object of layer.objects) paint(grid, map, objectBounds(object, context.offsetX, context.offsetY, map.tilewidth, map.tileheight), 1);
      return;
    }
    if (!isTileLayer(layer)) return;
    const collisionLayer = normalizedName(layer.name) === 'collision' || propertyValue(layer.properties, 'collision') === true;
    if (collisionLayer) sources += 1;
    layer.data.forEach((rawGid, index) => {
      const gid = normalizedGid(rawGid);
      if (!gid) return;
      const x = context.offsetX + (index % layer.width) * map.tilewidth;
      const y = context.offsetY + Math.floor(index / layer.width) * map.tileheight;
      const definition = tileDefinitions.get(gid);
      if (collisionLayer || propertyValue(definition?.tile.properties, 'collides') === true) paint(grid, map, { left: x, top: y, right: x + map.tilewidth, bottom: y + map.tileheight }, 1);
      if (propertyValue(definition?.tile.properties, 'collides') === true) sources += 1;
      if (!definition) return;
      const origin = tileCollisionOrigin(map, definition, x, y);
      for (const object of definition.tile.objectgroup?.objects ?? []) { sources += 1; paint(grid, map, objectBounds(object, origin.x, origin.y, origin.width, origin.height), 1); }
    });
  });
  if (sources === 0) return invalid('At least one collision tile layer, object layer, collidable tile, or tile collision object is required.');
  walkLayers(map, (layer, context) => {
    if (!isObjectLayer(layer) || (normalizedName(layer.name) !== 'portals' && propertyValue(layer.properties, 'portals') !== true)) return;
    for (const object of layer.objects) paint(grid, map, objectBounds(object, context.offsetX, context.offsetY, map.tilewidth, map.tileheight), 0);
  });
  return grid;
};

const integerProperty = (object: TiledObject, name: string, fallback?: number): number => { const value = propertyValue(object.properties, name) ?? fallback; if (!Number.isInteger(value)) return invalid(`Portal property ${name} must be an integer.`); return Number(value); };
const stringProperty = (object: TiledObject, name: string): string => { const value = propertyValue(object.properties, name); if (typeof value !== 'string' || !value.trim()) return invalid(`Portal property ${name} must be a non-empty string.`); return value.trim(); };

export const extractEmbeddedPortals = (map: TiledMapJson): EmbeddedPortalDefinition[] => {
  const result: EmbeddedPortalDefinition[] = [];
  walkLayers(map, (layer, context) => {
    if (!isObjectLayer(layer) || (normalizedName(layer.name) !== 'portals' && propertyValue(layer.properties, 'portals') !== true)) return;
    for (const object of layer.objects.filter((item) => !item.type || normalizedName(item.type) === 'portal')) result.push({ sourceX: integerProperty(object, 'sourceX', Math.floor((context.offsetX + (object.x ?? 0)) / map.tilewidth)), sourceY: integerProperty(object, 'sourceY', Math.floor((context.offsetY + (object.y ?? 0)) / map.tileheight)), destinationMapKey: stringProperty(object, 'destinationMapKey'), targetX: integerProperty(object, 'targetX'), targetY: integerProperty(object, 'targetY') });
  });
  return result;
};
