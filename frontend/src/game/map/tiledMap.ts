import type { ClientPortal, CompiledTileLayer, LoadedMapDefinition, TiledLayer, TiledMapJson, TiledObject, TiledObjectLayer, TiledProperty, TiledTileLayer } from '../../contracts/tiled';

const TREE_TRUNK_GID = 3;
const TREE_TRUNK_LAYER_NAME = 'tree trunks';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isProperties = (value: unknown): value is TiledProperty[] | undefined => value === undefined || (Array.isArray(value) && value.every((item) => isRecord(item) && typeof item.name === 'string' && Object.hasOwn(item, 'value')));
const propertyValue = (properties: TiledProperty[] | undefined, name: string): unknown => properties?.find((property) => property.name === name)?.value;
const isTileLayer = (layer: TiledLayer): layer is TiledTileLayer => layer.type === 'tilelayer';
const isObjectLayer = (layer: TiledLayer): layer is TiledObjectLayer => layer.type === 'objectgroup';

const decodeBase64 = (value: string): Uint8Array => {
  const binary = atob(value.replace(/\s+/g, ''));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const decompress = async (bytes: Uint8Array, compression: string | undefined): Promise<Uint8Array> => {
  if (!compression) return bytes;
  if (compression !== 'zlib' && compression !== 'gzip') throw new Error(`Unsupported Tiled compression: ${compression}.`);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(compression === 'zlib' ? 'deflate' : 'gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

export const decodeTiledMapPayload = async (input: unknown): Promise<unknown> => {
  if (!isRecord(input) || !Array.isArray(input.layers)) return input;
  const layers = await Promise.all(input.layers.map(async (layer) => {
    if (!isRecord(layer) || layer.type !== 'tilelayer' || typeof layer.data !== 'string') return layer;
    if (layer.encoding !== 'base64') throw new Error(`Tile layer ${String(layer.name ?? '')} uses an unsupported encoding.`);
    const bytes = await decompress(decodeBase64(layer.data), typeof layer.compression === 'string' ? layer.compression : undefined);
    if (bytes.byteLength % 4 !== 0) throw new Error(`Tile layer ${String(layer.name ?? '')} has invalid binary data.`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const data = Array.from({ length: bytes.byteLength / 4 }, (_, index) => view.getUint32(index * 4, true));
    return { ...layer, data };
  }));
  return { ...input, layers };
};

export const parseTiledMap = (input: unknown): TiledMapJson => {
  if (!isRecord(input)) throw new Error('The Tiled map root must be an object.');
  const { type, orientation, infinite, width, height, tilewidth, tileheight, layers, tilesets } = input;
  if (type !== 'map' || orientation !== 'orthogonal' || infinite !== false || !Number.isInteger(width) || !Number.isInteger(height) || !Number.isInteger(tilewidth) || !Number.isInteger(tileheight) || Number(width) <= 0 || Number(height) <= 0 || Number(tilewidth) <= 0 || Number(tileheight) <= 0 || !Array.isArray(layers) || !Array.isArray(tilesets) || !isProperties(input.properties)) throw new Error('The Tiled map dimensions, tilesets, or layers are invalid.');
  for (const layer of layers) {
    if (!isRecord(layer) || typeof layer.name !== 'string' || typeof layer.type !== 'string' || !isProperties(layer.properties)) throw new Error('Every Tiled layer must include a name and type.');
    if (layer.type === 'tilelayer' && (!Number.isInteger(layer.width) || !Number.isInteger(layer.height) || Number(layer.width) <= 0 || Number(layer.height) <= 0 || !Array.isArray(layer.data) || !layer.data.every((tile) => Number.isInteger(tile) && Number(tile) >= 0))) throw new Error(`Tile layer ${layer.name} is malformed.`);
    if (layer.type === 'objectgroup' && (!Array.isArray(layer.objects) || !layer.objects.every((object) => isRecord(object) && (object.x === undefined || typeof object.x === 'number') && (object.y === undefined || typeof object.y === 'number') && (object.width === undefined || typeof object.width === 'number') && (object.height === undefined || typeof object.height === 'number') && isProperties(object.properties)))) throw new Error(`Object layer ${layer.name} is malformed.`);
    if (layer.type !== 'tilelayer' && layer.type !== 'objectgroup') throw new Error(`Unsupported Tiled layer type: ${layer.type}.`);
  }
  return input as unknown as TiledMapJson;
};

const normalizeVisualLayerData = (map: TiledMapJson, layer: TiledTileLayer): number[] => {
  const expectedLength = map.width * map.height;
  if (layer.width === map.width && layer.height === map.height && layer.data.length === expectedLength) return layer.data;
  const normalized = new Array<number>(expectedLength).fill(0);
  const copiedWidth = Math.min(map.width, layer.width);
  const copiedHeight = Math.min(map.height, layer.height);
  for (let y = 0; y < copiedHeight; y += 1) for (let x = 0; x < copiedWidth; x += 1) normalized[y * map.width + x] = layer.data[y * layer.width + x] ?? 0;
  return normalized;
};

const compileLayers = (map: TiledMapJson): CompiledTileLayer[] => map.layers.filter(isTileLayer).filter((layer) => layer.visible !== false && propertyValue(layer.properties, 'collision') !== true).map((layer) => ({ name: layer.name, band: propertyValue(layer.properties, 'renderBand') === 'above' ? 'above' : 'below', opacity: typeof layer.opacity === 'number' ? layer.opacity : 1, data: normalizeVisualLayerData(map, layer) }));

const markRectangle = (grid: Uint8Array, map: TiledMapJson, object: TiledObject): void => {
  const left = Math.floor((object.x ?? 0) / map.tilewidth);
  const top = Math.floor((object.y ?? 0) / map.tileheight);
  const right = Math.ceil(((object.x ?? 0) + Math.max(object.width ?? map.tilewidth, 1)) / map.tilewidth);
  const bottom = Math.ceil(((object.y ?? 0) + Math.max(object.height ?? map.tileheight, 1)) / map.tileheight);
  for (let y = Math.max(0, top); y < Math.min(map.height, bottom); y += 1) for (let x = Math.max(0, left); x < Math.min(map.width, right); x += 1) grid[y * map.width + x] = 1;
};

const markTreeFootprints = (grid: Uint8Array, map: TiledMapJson): void => {
  for (const layer of map.layers.filter(isTileLayer)) {
    if (layer.name.trim().toLowerCase() !== TREE_TRUNK_LAYER_NAME) continue;
    layer.data.forEach((rawGid, index) => {
      if ((rawGid & 0x1fffffff) !== TREE_TRUNK_GID) return;
      const treeX = index % map.width;
      const treeY = Math.floor(index / map.width);
      for (let y = treeY - 1; y <= treeY; y += 1) {
        for (let x = treeX - 1; x <= treeX + 1; x += 1) {
          if (x >= 0 && y >= 0 && x < map.width && y < map.height) grid[y * map.width + x] = 1;
        }
      }
    });
  }
};

const compileCollision = (map: TiledMapJson): Uint8Array => {
  const grid = new Uint8Array(map.width * map.height);
  for (const layer of map.layers) {
    if (isTileLayer(layer) && (layer.name.toLowerCase() === 'collision' || propertyValue(layer.properties, 'collision') === true)) {
      if (layer.width !== map.width || layer.height !== map.height || layer.data.length !== grid.length) throw new Error(`Collision layer ${layer.name} does not match map dimensions.`);
      layer.data.forEach((gid, index) => { if (gid !== 0) grid[index] = 1; });
    }
    if (isObjectLayer(layer) && (layer.name.toLowerCase() === 'collisions' || propertyValue(layer.properties, 'collision') === true)) layer.objects.forEach((object) => markRectangle(grid, map, object));
  }
  for (const tileset of map.tilesets) for (const tile of tileset.tiles ?? []) if (propertyValue(tile.properties, 'collides') === true) for (const layer of map.layers.filter(isTileLayer)) layer.data.forEach((gid, index) => { if ((gid & 0x1fffffff) === tileset.firstgid + tile.id && index < grid.length) grid[index] = 1; });
  markTreeFootprints(grid, map);
  for (const layer of map.layers.filter(isObjectLayer).filter((item) => item.name.toLowerCase() === 'portals' || propertyValue(item.properties, 'portals') === true)) for (const object of layer.objects) {
    const x = Math.floor((object.x ?? 0) / map.tilewidth);
    const y = Math.floor((object.y ?? 0) / map.tileheight);
    if (x >= 0 && y >= 0 && x < map.width && y < map.height) grid[y * map.width + x] = 0;
  }
  return grid;
};

const integerProperty = (object: TiledObject, name: string, fallback?: number): number => { const value = propertyValue(object.properties, name) ?? fallback; if (!Number.isInteger(value)) throw new Error(`Portal property ${name} must be an integer.`); return Number(value); };
const stringProperty = (object: TiledObject, name: string): string => { const value = propertyValue(object.properties, name); if (typeof value !== 'string' || !value.trim()) throw new Error(`Portal property ${name} must be a string.`); return value; };
const extractPortals = (map: TiledMapJson): ClientPortal[] => map.layers.filter(isObjectLayer).filter((layer) => layer.name.toLowerCase() === 'portals' || propertyValue(layer.properties, 'portals') === true).flatMap((layer) => layer.objects.filter((object) => !object.type || object.type.toLowerCase() === 'portal').map((object) => ({ sourceX: integerProperty(object, 'sourceX', Math.floor((object.x ?? 0) / map.tilewidth)), sourceY: integerProperty(object, 'sourceY', Math.floor((object.y ?? 0) / map.tileheight)), destinationMapKey: stringProperty(object, 'destinationMapKey'), targetX: integerProperty(object, 'targetX'), targetY: integerProperty(object, 'targetY') })));

export const compileMapDefinition = (key: string, source: TiledMapJson): LoadedMapDefinition => ({ key, source, width: source.width, height: source.height, tileWidth: source.tilewidth, tileHeight: source.tileheight, layers: compileLayers(source), collision: compileCollision(source), portals: extractPortals(source) });
export const isInsideMap = (map: Pick<LoadedMapDefinition, 'width' | 'height'>, x: number, y: number): boolean => x >= 0 && y >= 0 && x < map.width && y < map.height;
export const isCollisionTile = (map: Pick<LoadedMapDefinition, 'width' | 'height' | 'collision'>, x: number, y: number): boolean => !isInsideMap(map, x, y) || map.collision[y * map.width + x] === 1;
