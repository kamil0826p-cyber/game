import type {
  ClientPortal,
  CompiledTileLayer,
  CompiledTileRenderDefinition,
  LoadedMapDefinition,
  TiledGroupLayer,
  TiledLayer,
  TiledMapJson,
  TiledObject,
  TiledObjectLayer,
  TiledProperty,
  TiledTileLayer,
} from '../../contracts/tiled';

export const TILED_FLIPPED_HORIZONTALLY_FLAG = 0x80000000;
export const TILED_FLIPPED_VERTICALLY_FLAG = 0x40000000;
export const TILED_FLIPPED_DIAGONALLY_FLAG = 0x20000000;
export const TILED_ROTATED_HEXAGONAL_120_FLAG = 0x10000000;
export const TILED_GID_MASK = 0x0fffffff;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const normalizedName = (value: string): string => value.trim().toLowerCase();
const isProperties = (value: unknown): value is TiledProperty[] | undefined => value === undefined || (Array.isArray(value) && value.every((item) => isRecord(item) && typeof item.name === 'string' && Object.hasOwn(item, 'value')));
export const propertyValue = (properties: TiledProperty[] | undefined, name: string): unknown => properties?.find((property) => normalizedName(property.name) === normalizedName(name))?.value;
const isTileLayer = (layer: TiledLayer): layer is TiledTileLayer => layer.type === 'tilelayer';
const isObjectLayer = (layer: TiledLayer): layer is TiledObjectLayer => layer.type === 'objectgroup';
const isGroupLayer = (layer: TiledLayer): layer is TiledGroupLayer => layer.type === 'group';
export const normalizedGid = (rawGid: number): number => rawGid & TILED_GID_MASK;

const decodeBase64 = (value: string): Uint8Array => {
  const binary = atob(value.replace(/\s+/g, ''));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const decodeLayer = async (layer: unknown): Promise<unknown> => {
  if (!isRecord(layer)) return layer;
  if (layer.type === 'group' && Array.isArray(layer.layers)) return { ...layer, layers: await Promise.all(layer.layers.map(decodeLayer)) };
  if (layer.type !== 'tilelayer' || typeof layer.data !== 'string') return layer;
  if (layer.encoding === 'csv') return { ...layer, data: layer.data.split(',').map((value) => Number(value.trim())) };
  if (layer.encoding !== 'base64') throw new Error(`Tile layer ${String(layer.name ?? '')} uses an unsupported encoding.`);
  let bytes = decodeBase64(layer.data);
  if (layer.compression) {
    if (layer.compression !== 'zlib' && layer.compression !== 'gzip') throw new Error(`Unsupported Tiled compression: ${String(layer.compression)}.`);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(layer.compression === 'zlib' ? 'deflate' : 'gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  if (bytes.byteLength % 4 !== 0) throw new Error(`Tile layer ${String(layer.name ?? '')} has invalid binary data.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { ...layer, data: Array.from({ length: bytes.byteLength / 4 }, (_, index) => view.getUint32(index * 4, true)) };
};

export const decodeTiledMapPayload = async (input: unknown): Promise<unknown> => {
  if (!isRecord(input) || !Array.isArray(input.layers)) return input;
  return { ...input, layers: await Promise.all(input.layers.map(decodeLayer)) };
};

const validateLayer = (layer: unknown): void => {
  if (!isRecord(layer) || typeof layer.name !== 'string' || typeof layer.type !== 'string' || !isProperties(layer.properties)) throw new Error('Every Tiled layer must include a valid name, type, and properties.');
  if (layer.type === 'tilelayer') {
    if (!Number.isInteger(layer.width) || !Number.isInteger(layer.height) || Number(layer.width) <= 0 || Number(layer.height) <= 0 || !Array.isArray(layer.data) || !layer.data.every((gid) => Number.isInteger(gid) && Number(gid) >= 0) || layer.data.length !== Number(layer.width) * Number(layer.height)) throw new Error(`Tile layer ${layer.name} is malformed.`);
    return;
  }
  if (layer.type === 'objectgroup') {
    if (!Array.isArray(layer.objects) || !layer.objects.every((object) => isRecord(object) && isProperties(object.properties))) throw new Error(`Object layer ${layer.name} is malformed.`);
    return;
  }
  if (layer.type === 'group') {
    if (!Array.isArray(layer.layers)) throw new Error(`Group layer ${layer.name} is malformed.`);
    layer.layers.forEach(validateLayer);
    return;
  }
  throw new Error(`Unsupported Tiled layer type: ${layer.type}.`);
};

export const parseTiledMap = (input: unknown): TiledMapJson => {
  if (!isRecord(input)) throw new Error('The Tiled map root must be an object.');
  const { type, orientation, infinite, width, height, tilewidth, tileheight, layers, tilesets } = input;
  if (type !== 'map' || orientation !== 'orthogonal' || infinite !== false || !Number.isInteger(width) || !Number.isInteger(height) || !Number.isInteger(tilewidth) || !Number.isInteger(tileheight) || Number(width) <= 0 || Number(height) <= 0 || Number(tilewidth) <= 0 || Number(tileheight) <= 0 || !Array.isArray(layers) || !Array.isArray(tilesets)) throw new Error('The Tiled map must be finite, orthogonal, and have positive dimensions.');
  layers.forEach(validateLayer);
  return input as unknown as TiledMapJson;
};

interface LayerContext { visible: boolean; opacity: number; offsetX: number; offsetY: number; band: 'below' | 'above' }

const childContext = (map: TiledMapJson, layer: TiledLayer, parent: LayerContext): LayerContext => ({
  visible: parent.visible && layer.visible !== false,
  opacity: parent.opacity * (typeof layer.opacity === 'number' ? layer.opacity : 1),
  offsetX: parent.offsetX + (layer.offsetx ?? 0) + (layer.x ?? 0) * map.tilewidth,
  offsetY: parent.offsetY + (layer.offsety ?? 0) + (layer.y ?? 0) * map.tileheight,
  band: propertyValue(layer.properties, 'renderBand') === 'above' ? 'above' : propertyValue(layer.properties, 'renderBand') === 'below' ? 'below' : parent.band,
});

const walkLayers = (map: TiledMapJson, visit: (layer: TiledLayer, context: LayerContext) => void): void => {
  const walk = (layers: TiledLayer[], parent: LayerContext): void => {
    for (const layer of layers) {
      const context = childContext(map, layer, parent);
      if (!context.visible) continue;
      if (isGroupLayer(layer)) walk(layer.layers, context); else visit(layer, context);
    }
  };
  walk(map.layers, { visible: true, opacity: 1, offsetX: 0, offsetY: 0, band: 'below' });
};

const compileLayers = (map: TiledMapJson): CompiledTileLayer[] => {
  const result: CompiledTileLayer[] = [];
  walkLayers(map, (layer, context) => {
    if (!isTileLayer(layer) || propertyValue(layer.properties, 'collision') === true || normalizedName(layer.name) === 'collision') return;
    result.push({ name: layer.name, band: context.band, opacity: context.opacity, width: layer.width, height: layer.height, offsetX: context.offsetX, offsetY: context.offsetY, data: layer.data });
  });
  return result;
};

const numberProperty = (properties: TiledProperty[] | undefined, name: string, fallback: number): number => {
  const value = propertyValue(properties, name);
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

const compileRenderDefinitions = (map: TiledMapJson): Map<number, CompiledTileRenderDefinition> => {
  const result = new Map<number, CompiledTileRenderDefinition>();
  for (const tileset of map.tilesets) {
    const tileWidth = tileset.tilewidth ?? map.tilewidth;
    const tileHeight = tileset.tileheight ?? map.tileheight;
    for (const tile of tileset.tiles ?? []) {
      result.set(tileset.firstgid + tile.id, {
        widthTiles: numberProperty(tile.properties, 'renderWidthTiles', (tile.imagewidth ?? tileWidth) / map.tilewidth),
        heightTiles: numberProperty(tile.properties, 'renderHeightTiles', (tile.imageheight ?? tileHeight) / map.tileheight),
        anchorX: numberProperty(tile.properties, 'renderAnchorX', 0),
        anchorY: numberProperty(tile.properties, 'renderAnchorY', 1),
        offsetXTiles: numberProperty(tile.properties, 'renderOffsetXTiles', (tileset.tileoffset?.x ?? 0) / map.tilewidth),
        offsetYTiles: numberProperty(tile.properties, 'renderOffsetYTiles', 1 + (tileset.tileoffset?.y ?? 0) / map.tileheight),
      });
    }
  }
  return result;
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

const compileCollision = (map: TiledMapJson): Uint8Array => {
  const grid = new Uint8Array(map.width * map.height);
  const tileDefinitions = new Map<number, NonNullable<TiledMapJson['tilesets'][number]['tiles']>[number]>();
  for (const tileset of map.tilesets) for (const tile of tileset.tiles ?? []) tileDefinitions.set(tileset.firstgid + tile.id, tile);
  walkLayers(map, (layer, context) => {
    if (isObjectLayer(layer) && (normalizedName(layer.name) === 'collisions' || propertyValue(layer.properties, 'collision') === true)) {
      for (const object of layer.objects) paint(grid, map, objectBounds(object, context.offsetX, context.offsetY, map.tilewidth, map.tileheight), 1);
      return;
    }
    if (!isTileLayer(layer)) return;
    const collisionLayer = normalizedName(layer.name) === 'collision' || propertyValue(layer.properties, 'collision') === true;
    layer.data.forEach((rawGid, index) => {
      const gid = normalizedGid(rawGid);
      if (!gid) return;
      const x = context.offsetX + (index % layer.width) * map.tilewidth;
      const y = context.offsetY + Math.floor(index / layer.width) * map.tileheight;
      const tile = tileDefinitions.get(gid);
      if (collisionLayer || propertyValue(tile?.properties, 'collides') === true) paint(grid, map, { left: x, top: y, right: x + map.tilewidth, bottom: y + map.tileheight }, 1);
      for (const object of tile?.objectgroup?.objects ?? []) paint(grid, map, objectBounds(object, x, y, map.tilewidth, map.tileheight), 1);
    });
  });
  walkLayers(map, (layer, context) => {
    if (!isObjectLayer(layer) || (normalizedName(layer.name) !== 'portals' && propertyValue(layer.properties, 'portals') !== true)) return;
    for (const object of layer.objects) paint(grid, map, objectBounds(object, context.offsetX, context.offsetY, map.tilewidth, map.tileheight), 0);
  });
  return grid;
};

const integerProperty = (object: TiledObject, name: string, fallback?: number): number => { const value = propertyValue(object.properties, name) ?? fallback; if (!Number.isInteger(value)) throw new Error(`Portal property ${name} must be an integer.`); return Number(value); };
const stringProperty = (object: TiledObject, name: string): string => { const value = propertyValue(object.properties, name); if (typeof value !== 'string' || !value.trim()) throw new Error(`Portal property ${name} must be a string.`); return value.trim(); };

const extractPortals = (map: TiledMapJson): ClientPortal[] => {
  const result: ClientPortal[] = [];
  walkLayers(map, (layer, context) => {
    if (!isObjectLayer(layer) || (normalizedName(layer.name) !== 'portals' && propertyValue(layer.properties, 'portals') !== true)) return;
    for (const object of layer.objects.filter((item) => !item.type || normalizedName(item.type) === 'portal')) result.push({ sourceX: integerProperty(object, 'sourceX', Math.floor((context.offsetX + (object.x ?? 0)) / map.tilewidth)), sourceY: integerProperty(object, 'sourceY', Math.floor((context.offsetY + (object.y ?? 0)) / map.tileheight)), destinationMapKey: stringProperty(object, 'destinationMapKey'), targetX: integerProperty(object, 'targetX'), targetY: integerProperty(object, 'targetY') });
  });
  return result;
};

export const compileMapDefinition = (key: string, source: TiledMapJson, sourceUrl = `/maps/${encodeURIComponent(key)}.json`): LoadedMapDefinition => ({ key, sourceUrl, source, width: source.width, height: source.height, tileWidth: source.tilewidth, tileHeight: source.tileheight, layers: compileLayers(source), tileRenderDefinitions: compileRenderDefinitions(source), collision: compileCollision(source), portals: extractPortals(source) });
export const isInsideMap = (map: Pick<LoadedMapDefinition, 'width' | 'height'>, x: number, y: number): boolean => x >= 0 && y >= 0 && x < map.width && y < map.height;
export const isCollisionTile = (map: Pick<LoadedMapDefinition, 'width' | 'height' | 'collision'>, x: number, y: number): boolean => !isInsideMap(map, x, y) || map.collision[y * map.width + x] === 1;
