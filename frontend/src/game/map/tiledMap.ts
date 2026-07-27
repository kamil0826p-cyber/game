import type {
  ClientPortal,
  CompiledTileLayer,
  LoadedMapDefinition,
  MapRenderPlane,
  TiledLayer,
  TiledMapJson,
  TiledObject,
  TiledObjectLayer,
  TiledProperty,
  TiledTileLayer,
} from '../../contracts/tiled';

export const TILED_FLIP_HORIZONTAL = 0x80000000;
export const TILED_FLIP_VERTICAL = 0x40000000;
export const TILED_FLIP_DIAGONAL = 0x20000000;
export const TILED_GID_MASK = 0x1fffffff;

interface LayerState {
  visible: boolean;
  opacity: number;
  offsetX: number;
  offsetY: number;
  plane: MapRenderPlane;
  collision: boolean;
  portals: boolean;
}

interface FlatLayer extends LayerState {
  layer: TiledTileLayer | TiledObjectLayer;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const propertiesValid = (value: unknown): value is TiledProperty[] | undefined =>
  value === undefined ||
  (Array.isArray(value) &&
    value.every(
      (property) =>
        isRecord(property) &&
        typeof property.name === 'string' &&
        Object.hasOwn(property, 'value'),
    ));

const propertyValue = (properties: TiledProperty[] | undefined, name: string): unknown =>
  properties?.find((property) => property.name === name)?.value;

const boolProperty = (properties: TiledProperty[] | undefined, name: string): boolean =>
  propertyValue(properties, name) === true;

const namedCollision = (name: string): boolean => {
  const normalized = name.trim().toLowerCase();
  return normalized === 'collision' || normalized === 'obstacles';
};

const namedPortals = (name: string): boolean => name.trim().toLowerCase() === 'portals';

const planeFor = (
  properties: TiledProperty[] | undefined,
  inherited: MapRenderPlane,
): MapRenderPlane => {
  const explicit = propertyValue(properties, 'renderPlane');
  if (explicit === 'above-entities' || boolProperty(properties, 'aboveEntities')) {
    return 'above-entities';
  }
  if (explicit === 'below-entities') return 'below-entities';
  return inherited;
};

const validateLayer = (layer: unknown): void => {
  if (
    !isRecord(layer) ||
    typeof layer.name !== 'string' ||
    typeof layer.type !== 'string' ||
    !propertiesValid(layer.properties)
  ) {
    throw new Error('Every Tiled layer must have valid name, type and properties fields.');
  }
  if (layer.type === 'group') {
    if (!Array.isArray(layer.layers)) throw new Error(`Group ${layer.name} has no layers.`);
    layer.layers.forEach(validateLayer);
    return;
  }
  if (layer.type === 'tilelayer') {
    const hasData = Array.isArray(layer.data);
    const hasChunks = Array.isArray(layer.chunks);
    if (hasData === hasChunks) {
      throw new Error(`Tile layer ${layer.name} must contain exactly one of data or chunks.`);
    }
    if (hasData) {
      if (
        !Number.isInteger(layer.width) ||
        !Number.isInteger(layer.height) ||
        !Array.isArray(layer.data) ||
        !layer.data.every((gid) => Number.isInteger(gid) && gid >= 0 && gid <= 0xffffffff)
      ) {
        throw new Error(`Tile layer ${layer.name} is malformed.`);
      }
    }
    return;
  }
  if (layer.type === 'objectgroup') {
    if (!Array.isArray(layer.objects)) throw new Error(`Object layer ${layer.name} has no objects.`);
    return;
  }
  throw new Error(`Unsupported Tiled layer type: ${layer.type}.`);
};

export const parseTiledMap = (input: unknown): TiledMapJson => {
  if (!isRecord(input)) throw new Error('The Tiled map root must be an object.');
  if (
    input.type !== 'map' ||
    input.orientation !== 'orthogonal' ||
    typeof input.infinite !== 'boolean' ||
    !Number.isInteger(input.width) ||
    !Number.isInteger(input.height) ||
    !Number.isInteger(input.tilewidth) ||
    !Number.isInteger(input.tileheight) ||
    Number(input.width) <= 0 ||
    Number(input.height) <= 0 ||
    Number(input.tilewidth) <= 0 ||
    Number(input.tileheight) <= 0 ||
    !Array.isArray(input.layers) ||
    !Array.isArray(input.tilesets) ||
    input.tilesets.length === 0 ||
    !propertiesValid(input.properties)
  ) {
    throw new Error('The Tiled map root is invalid or unsupported.');
  }
  input.layers.forEach(validateLayer);
  return input as unknown as TiledMapJson;
};

const flattenLayers = (
  layers: readonly TiledLayer[],
  inherited: LayerState = {
    visible: true,
    opacity: 1,
    offsetX: 0,
    offsetY: 0,
    plane: 'below-entities',
    collision: false,
    portals: false,
  },
): FlatLayer[] => {
  const result: FlatLayer[] = [];
  for (const layer of layers) {
    const state: LayerState = {
      visible: inherited.visible && layer.visible !== false,
      opacity: inherited.opacity * (layer.opacity ?? 1),
      offsetX: inherited.offsetX + (layer.offsetx ?? 0),
      offsetY: inherited.offsetY + (layer.offsety ?? 0),
      plane: planeFor(layer.properties, inherited.plane),
      collision: inherited.collision || namedCollision(layer.name) || boolProperty(layer.properties, 'collision'),
      portals: inherited.portals || namedPortals(layer.name) || boolProperty(layer.properties, 'portals'),
    };
    if (layer.type === 'group') result.push(...flattenLayers(layer.layers, state));
    else result.push({ layer, ...state });
  }
  return result;
};

const layerData = (map: TiledMapJson, layer: TiledTileLayer): number[] => {
  const output = new Array<number>(map.width * map.height).fill(0);
  if (layer.data) {
    if (layer.width !== map.width || layer.height !== map.height || layer.data.length !== output.length) {
      throw new Error(`Tile layer ${layer.name} does not match finite map dimensions.`);
    }
    return layer.data.map((gid) => gid >>> 0);
  }
  for (const chunk of layer.chunks ?? []) {
    if (chunk.data.length !== chunk.width * chunk.height) {
      throw new Error(`Chunk in ${layer.name} is malformed.`);
    }
    chunk.data.forEach((gid, index) => {
      const x = chunk.x + (index % chunk.width);
      const y = chunk.y + Math.floor(index / chunk.width);
      if (x >= 0 && y >= 0 && x < map.width && y < map.height) {
        output[y * map.width + x] = gid >>> 0;
      }
    });
  }
  return output;
};

const integerProperty = (object: TiledObject, name: string, fallback?: number): number => {
  const value = propertyValue(object.properties, name) ?? fallback;
  if (!Number.isInteger(value)) throw new Error(`Portal property ${name} must be an integer.`);
  return Number(value);
};

const stringProperty = (object: TiledObject, name: string): string => {
  const value = propertyValue(object.properties, name);
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Portal property ${name} must be a non-empty string.`);
  }
  return value.trim();
};

const compileRenderLayers = (map: TiledMapJson): CompiledTileLayer[] =>
  flattenLayers(map.layers)
    .filter((entry): entry is FlatLayer & { layer: TiledTileLayer } => entry.layer.type === 'tilelayer')
    .filter(({ visible, collision }) => visible && !collision)
    .map(({ layer, opacity, offsetX, offsetY, plane }, index) => ({
      id: layer.id ?? index,
      name: layer.name,
      plane,
      opacity,
      offsetX,
      offsetY,
      data: layerData(map, layer),
    }));

const markRectangle = (
  grid: Uint8Array,
  map: TiledMapJson,
  object: TiledObject,
  offsetX: number,
  offsetY: number,
): void => {
  if (object.point || object.ellipse || object.polygon || object.polyline || (object.rotation ?? 0) !== 0) {
    throw new Error(`Collision object ${object.name ?? object.id ?? '<unnamed>'} must be an axis-aligned rectangle.`);
  }
  const x = (object.x ?? 0) + offsetX;
  const y = (object.y ?? 0) + offsetY;
  const width = object.width ?? 0;
  const height = object.height ?? 0;
  if (width <= 0 || height <= 0) throw new Error('Collision objects must have positive size.');
  const left = Math.floor(x / map.tilewidth);
  const top = Math.floor(y / map.tileheight);
  const right = Math.ceil((x + width) / map.tilewidth);
  const bottom = Math.ceil((y + height) / map.tileheight);
  for (let tileY = top; tileY < bottom; tileY += 1) {
    for (let tileX = left; tileX < right; tileX += 1) {
      if (tileX >= 0 && tileY >= 0 && tileX < map.width && tileY < map.height) {
        grid[tileY * map.width + tileX] = 1;
      }
    }
  }
};

const compileCollision = (map: TiledMapJson): Uint8Array => {
  const grid = new Uint8Array(map.width * map.height);
  let sources = 0;
  for (const { layer, offsetX, offsetY, collision } of flattenLayers(map.layers)) {
    if (!collision) continue;
    sources += 1;
    if (layer.type === 'tilelayer') {
      layerData(map, layer).forEach((gid, index) => {
        if ((gid & TILED_GID_MASK) !== 0) grid[index] = 1;
      });
    } else {
      for (const object of layer.objects) markRectangle(grid, map, object, offsetX, offsetY);
    }
  }
  if (sources === 0) throw new Error('The map must include a collision tile or object layer.');
  return grid;
};

const extractPortals = (map: TiledMapJson): ClientPortal[] => {
  const portals: ClientPortal[] = [];
  const sources = new Set<string>();
  for (const { layer, offsetX, offsetY, portals: portalLayer } of flattenLayers(map.layers)) {
    if (layer.type !== 'objectgroup' || !portalLayer) continue;
    for (const object of layer.objects) {
      if ((object.class ?? object.type ?? '').trim().toLowerCase() !== 'portal') continue;
      const portal: ClientPortal = {
        sourceX: integerProperty(object, 'sourceX', Math.floor(((object.x ?? 0) + offsetX) / map.tilewidth)),
        sourceY: integerProperty(object, 'sourceY', Math.floor(((object.y ?? 0) + offsetY) / map.tileheight)),
        destinationMapKey: stringProperty(object, 'destinationMapKey'),
        targetX: integerProperty(object, 'targetX'),
        targetY: integerProperty(object, 'targetY'),
      };
      const key = `${portal.sourceX},${portal.sourceY}`;
      if (sources.has(key)) throw new Error(`Multiple portals share source tile ${key}.`);
      sources.add(key);
      portals.push(portal);
    }
  }
  return portals;
};

export const compileMapDefinition = (key: string, source: TiledMapJson): LoadedMapDefinition => ({
  key,
  source,
  width: source.width,
  height: source.height,
  tileWidth: source.tilewidth,
  tileHeight: source.tileheight,
  renderLayers: compileRenderLayers(source),
  collision: compileCollision(source),
  portals: extractPortals(source),
});

export const isInsideMap = (
  map: Pick<LoadedMapDefinition, 'width' | 'height'>,
  x: number,
  y: number,
): boolean => x >= 0 && y >= 0 && x < map.width && y < map.height;

export const isCollisionTile = (
  map: Pick<LoadedMapDefinition, 'width' | 'height' | 'collision'>,
  x: number,
  y: number,
): boolean => !isInsideMap(map, x, y) || map.collision[y * map.width + x] === 1;
