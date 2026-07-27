import type {
  ClientPortal,
  LoadedMapDefinition,
  TiledLayer,
  TiledMapJson,
  TiledObject,
  TiledObjectLayer,
  TiledProperty,
  TiledTileLayer,
} from '../../contracts/tiled';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPropertyArray = (value: unknown): value is TiledProperty[] | undefined =>
  value === undefined ||
  (Array.isArray(value) &&
    value.every(
      (property) =>
        isRecord(property) &&
        typeof property.name === 'string' &&
        Object.hasOwn(property, 'value'),
    ));

const isTileLayer = (layer: TiledLayer): layer is TiledTileLayer =>
  layer.type === 'tilelayer';

const isObjectLayer = (layer: TiledLayer): layer is TiledObjectLayer =>
  layer.type === 'objectgroup';

const propertyValue = (
  properties: TiledProperty[] | undefined,
  name: string,
): unknown => properties?.find((property) => property.name === name)?.value;

const integerProperty = (
  object: TiledObject,
  name: string,
  fallback?: number,
): number => {
  const value = propertyValue(object.properties, name) ?? fallback;
  if (!Number.isInteger(value)) {
    throw new Error(`Portal property ${name} must be an integer.`);
  }
  return Number(value);
};

const stringProperty = (object: TiledObject, name: string): string => {
  const value = propertyValue(object.properties, name);
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Portal property ${name} must be a non-empty string.`);
  }
  return value;
};

export const parseTiledMap = (input: unknown): TiledMapJson => {
  if (!isRecord(input)) {
    throw new Error('The Tiled map root must be an object.');
  }

  const { type, orientation, infinite, width, height, tilewidth, tileheight, layers } = input;
  if (
    type !== 'map' ||
    typeof orientation !== 'string' ||
    typeof infinite !== 'boolean' ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    !Number.isInteger(tilewidth) ||
    !Number.isInteger(tileheight) ||
    Number(width) <= 0 ||
    Number(height) <= 0 ||
    Number(tilewidth) <= 0 ||
    Number(tileheight) <= 0 ||
    !Array.isArray(layers) ||
    !isPropertyArray(input.properties)
  ) {
    throw new Error('The Tiled map dimensions or layer collection are invalid.');
  }

  for (const layer of layers) {
    if (
      !isRecord(layer) ||
      typeof layer.name !== 'string' ||
      typeof layer.type !== 'string' ||
      !isPropertyArray(layer.properties)
    ) {
      throw new Error('Every Tiled layer must include string name and type fields.');
    }

    if (layer.type === 'tilelayer') {
      if (
        !Number.isInteger(layer.width) ||
        !Number.isInteger(layer.height) ||
        !Array.isArray(layer.data) ||
        !layer.data.every((tile) => Number.isInteger(tile) && Number(tile) >= 0)
      ) {
        throw new Error(`Tile layer ${layer.name} is malformed.`);
      }
    } else if (layer.type === 'objectgroup') {
      if (!Array.isArray(layer.objects)) {
        throw new Error(`Object layer ${layer.name} must contain an objects array.`);
      }
      for (const object of layer.objects) {
        if (
          !isRecord(object) ||
          (object.type !== undefined && typeof object.type !== 'string') ||
          (object.x !== undefined && typeof object.x !== 'number') ||
          (object.y !== undefined && typeof object.y !== 'number') ||
          !isPropertyArray(object.properties)
        ) {
          throw new Error(`Object layer ${layer.name} contains malformed data.`);
        }
      }
    } else {
      throw new Error(`Unsupported Tiled layer type: ${layer.type}.`);
    }
  }

  return input as unknown as TiledMapJson;
};

const collisionLayers = (map: TiledMapJson): TiledTileLayer[] =>
  map.layers.filter((layer): layer is TiledTileLayer => {
    if (!isTileLayer(layer)) return false;
    const normalizedName = layer.name.toLowerCase();
    return (
      normalizedName === 'collision' ||
      normalizedName === 'obstacles' ||
      propertyValue(layer.properties, 'collision') === true
    );
  });

const compileCollisionData = (
  map: TiledMapJson,
): { collision: Uint8Array; obstacles: number[] } => {
  const layers = collisionLayers(map);
  if (layers.length === 0) {
    throw new Error('The map must include at least one collision tile layer.');
  }

  const tileCount = map.width * map.height;
  const collision = new Uint8Array(tileCount);
  const obstacles = new Array<number>(tileCount).fill(0);

  for (const layer of layers) {
    if (
      layer.width !== map.width ||
      layer.height !== map.height ||
      layer.data.length !== tileCount
    ) {
      throw new Error(`Collision layer ${layer.name} does not match the map dimensions.`);
    }
    layer.data.forEach((tile, index) => {
      if (tile !== 0) {
        collision[index] = 1;
        obstacles[index] = tile;
      }
    });
  }

  return { collision, obstacles };
};

const extractPortals = (map: TiledMapJson): ClientPortal[] => {
  const portalLayers = map.layers.filter(
    (layer): layer is TiledObjectLayer =>
      isObjectLayer(layer) &&
      (layer.name.toLowerCase() === 'portals' ||
        propertyValue(layer.properties, 'portals') === true),
  );

  const portals: ClientPortal[] = [];
  for (const layer of portalLayers) {
    for (const object of layer.objects) {
      if (object.type && object.type.toLowerCase() !== 'portal') continue;
      portals.push({
        sourceX: integerProperty(
          object,
          'sourceX',
          object.x === undefined ? undefined : Math.floor(object.x / map.tilewidth),
        ),
        sourceY: integerProperty(
          object,
          'sourceY',
          object.y === undefined ? undefined : Math.floor(object.y / map.tileheight),
        ),
        destinationMapKey: stringProperty(object, 'destinationMapKey'),
        targetX: integerProperty(object, 'targetX'),
        targetY: integerProperty(object, 'targetY'),
      });
    }
  }
  return portals;
};

export const compileMapDefinition = (
  key: string,
  source: TiledMapJson,
): LoadedMapDefinition => {
  const groundLayer = source.layers.find(
    (layer): layer is TiledTileLayer =>
      isTileLayer(layer) && layer.name.toLowerCase() === 'ground',
  );
  if (!groundLayer || groundLayer.data.length !== source.width * source.height) {
    throw new Error(`Map ${key} must include a full-size ground layer.`);
  }

  const { collision, obstacles } = compileCollisionData(source);
  return {
    key,
    source,
    width: source.width,
    height: source.height,
    tileWidth: source.tilewidth,
    tileHeight: source.tileheight,
    ground: groundLayer.data,
    obstacles,
    collision,
    portals: extractPortals(source),
  };
};

export const isInsideMap = (
  map: Pick<LoadedMapDefinition, 'width' | 'height'>,
  x: number,
  y: number,
): boolean => x >= 0 && y >= 0 && x < map.width && y < map.height;

export const isCollisionTile = (
  map: Pick<LoadedMapDefinition, 'width' | 'height' | 'collision'>,
  x: number,
  y: number,
): boolean =>
  !isInsideMap(map, x, y) || map.collision[y * map.width + x] === 1;