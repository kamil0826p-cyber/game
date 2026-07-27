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

const FLIP_MASK = 0x1fffffff;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const propertiesValid = (value: unknown): value is TiledProperty[] | undefined =>
  value === undefined ||
  (Array.isArray(value) &&
    value.every(
      (property) =>
        isRecord(property) && typeof property.name === 'string' && Object.hasOwn(property, 'value'),
    ));

const propertyValue = (properties: TiledProperty[] | undefined, name: string): unknown =>
  properties?.find((property) => property.name === name)?.value;

const boolProperty = (properties: TiledProperty[] | undefined, name: string): boolean =>
  propertyValue(properties, name) === true;

const flattenLayers = (
  layers: readonly TiledLayer[],
  inherited = { visible: true, opacity: 1, offsetX: 0, offsetY: 0 },
): Array<{ layer: TiledTileLayer | TiledObjectLayer; visible: boolean; opacity: number; offsetX: number; offsetY: number }> => {
  const result: Array<{ layer: TiledTileLayer | TiledObjectLayer; visible: boolean; opacity: number; offsetX: number; offsetY: number }> = [];
  for (const layer of layers) {
    const state = {
      visible: inherited.visible && layer.visible !== false,
      opacity: inherited.opacity * (layer.opacity ?? 1),
      offsetX: inherited.offsetX + (layer.offsetx ?? 0),
      offsetY: inherited.offsetY + (layer.offsety ?? 0),
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
    return layer.data.map((gid) => gid & FLIP_MASK);
  }
  if (!layer.chunks) throw new Error(`Tile layer ${layer.name} has neither data nor chunks.`);
  for (const chunk of layer.chunks) {
    if (chunk.data.length !== chunk.width * chunk.height) throw new Error(`Chunk in ${layer.name} is malformed.`);
    chunk.data.forEach((gid, index) => {
      const x = chunk.x + (index % chunk.width);
      const y = chunk.y + Math.floor(index / chunk.width);
      if (x >= 0 && y >= 0 && x < map.width && y < map.height) output[y * map.width + x] = gid & FLIP_MASK;
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
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`Portal property ${name} must be a non-empty string.`);
  return value;
};

export const parseTiledMap = (input: unknown): TiledMapJson => {
  if (!isRecord(input)) throw new Error('The Tiled map root must be an object.');
  if (
    input.type !== 'map' || input.orientation !== 'orthogonal' || typeof input.infinite !== 'boolean' ||
    !Number.isInteger(input.width) || !Number.isInteger(input.height) || !Number.isInteger(input.tilewidth) ||
    !Number.isInteger(input.tileheight) || Number(input.width) <= 0 || Number(input.height) <= 0 ||
    Number(input.tilewidth) <= 0 || Number(input.tileheight) <= 0 || !Array.isArray(input.layers) ||
    !Array.isArray(input.tilesets) || !propertiesValid(input.properties)
  ) throw new Error('The Tiled map root is invalid or unsupported.');
  return input as unknown as TiledMapJson;
};

const renderPlane = (layer: TiledTileLayer): MapRenderPlane => {
  const explicit = propertyValue(layer.properties, 'renderPlane');
  if (explicit === 'above-entities' || boolProperty(layer.properties, 'aboveEntities')) return 'above-entities';
  return 'below-entities';
};

const compileRenderLayers = (map: TiledMapJson): CompiledTileLayer[] =>
  flattenLayers(map.layers)
    .filter((entry): entry is typeof entry & { layer: TiledTileLayer } => entry.layer.type === 'tilelayer')
    .filter(({ layer, visible }) => visible && !boolProperty(layer.properties, 'collision') && layer.name.toLowerCase() !== 'collision')
    .map(({ layer, opacity, offsetX, offsetY }, index) => ({
      id: layer.id ?? index,
      name: layer.name,
      plane: renderPlane(layer),
      opacity,
      offsetX,
      offsetY,
      data: layerData(map, layer),
    }));

const markRectangle = (grid: Uint8Array, map: TiledMapJson, x: number, y: number, width: number, height: number): void => {
  const left = Math.floor(x / map.tilewidth);
  const top = Math.floor(y / map.tileheight);
  const right = Math.ceil((x + Math.max(width, 1)) / map.tilewidth);
  const bottom = Math.ceil((y + Math.max(height, 1)) / map.tileheight);
  for (let tileY = top; tileY < bottom; tileY += 1) for (let tileX = left; tileX < right; tileX += 1) {
    if (tileX >= 0 && tileY >= 0 && tileX < map.width && tileY < map.height) grid[tileY * map.width + tileX] = 1;
  }
};

const compileCollision = (map: TiledMapJson): Uint8Array => {
  const grid = new Uint8Array(map.width * map.height);
  let sources = 0;
  for (const { layer, offsetX, offsetY } of flattenLayers(map.layers)) {
    const collision = layer.name.toLowerCase() === 'collision' || layer.name.toLowerCase() === 'obstacles' || boolProperty(layer.properties, 'collision');
    if (!collision) continue;
    sources += 1;
    if (layer.type === 'tilelayer') layerData(map, layer).forEach((gid, index) => { if (gid !== 0) grid[index] = 1; });
    else for (const object of layer.objects) markRectangle(grid, map, (object.x ?? 0) + offsetX, (object.y ?? 0) + offsetY, object.width ?? 1, object.height ?? 1);
  }
  if (sources === 0) throw new Error('The map must include a collision tile or object layer.');
  return grid;
};

const extractPortals = (map: TiledMapJson): ClientPortal[] => {
  const portals: ClientPortal[] = [];
  for (const { layer, offsetX, offsetY } of flattenLayers(map.layers)) {
    if (layer.type !== 'objectgroup' || (layer.name.toLowerCase() !== 'portals' && !boolProperty(layer.properties, 'portals'))) continue;
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

export const isInsideMap = (map: Pick<LoadedMapDefinition, 'width' | 'height'>, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < map.width && y < map.height;

export const isCollisionTile = (map: Pick<LoadedMapDefinition, 'width' | 'height' | 'collision'>, x: number, y: number): boolean =>
  !isInsideMap(map, x, y) || map.collision[y * map.width + x] === 1;
