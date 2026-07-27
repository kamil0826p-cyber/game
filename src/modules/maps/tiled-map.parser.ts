import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type {
  EmbeddedPortalDefinition,
  TiledGroupLayer,
  TiledLayer,
  TiledMapJson,
  TiledMapMetadata,
  TiledObject,
  TiledObjectLayer,
  TiledProperty,
  TiledPointDefinition,
  TiledTileLayer,
  TiledTilesetReference,
} from './tiled-map.types.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const invalidMap = (reason: string): never => {
  throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', { reason });
};

const hasValidProperties = (value: unknown): value is TiledProperty[] | undefined =>
  value === undefined ||
  (Array.isArray(value) &&
    value.every(
      (property) =>
        isRecord(property) &&
        typeof property.name === 'string' &&
        Object.prototype.hasOwnProperty.call(property, 'value'),
    ));

const hasValidLayerAttributes = (layer: Record<string, unknown>): boolean =>
  (layer.class === undefined || typeof layer.class === 'string') &&
  (layer.visible === undefined || typeof layer.visible === 'boolean') &&
  (layer.opacity === undefined ||
    (typeof layer.opacity === 'number' &&
      Number.isFinite(layer.opacity) &&
      layer.opacity >= 0 &&
      layer.opacity <= 1)) &&
  (layer.x === undefined || Number.isInteger(layer.x)) &&
  (layer.y === undefined || Number.isInteger(layer.y)) &&
  (layer.offsetx === undefined ||
    (typeof layer.offsetx === 'number' && Number.isFinite(layer.offsetx))) &&
  (layer.offsety === undefined ||
    (typeof layer.offsety === 'number' && Number.isFinite(layer.offsety)));

const propertyValue = (properties: TiledProperty[] | undefined, name: string): unknown =>
  properties?.find((property) => property.name === name)?.value;

const integerProperty = (
  properties: TiledProperty[] | undefined,
  name: string,
  fallback?: number,
): number => {
  const value = propertyValue(properties, name) ?? fallback;
  if (!Number.isInteger(value)) {
    return invalidMap(`Property ${name} must be an integer.`);
  }
  return Number(value);
};

const stringProperty = (
  properties: TiledProperty[] | undefined,
  name: string,
): string => {
  const value = propertyValue(properties, name);
  if (typeof value !== 'string' || value.trim().length === 0) {
    return invalidMap(`Property ${name} must be a non-empty string.`);
  }
  return value.trim();
};

const booleanProperty = (
  properties: TiledProperty[] | undefined,
  name: string,
  fallback = false,
): boolean => {
  const value = propertyValue(properties, name);
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'boolean') {
    return invalidMap(`Property ${name} must be a boolean.`);
  }
  return value;
};

const isTileLayer = (layer: TiledLayer): layer is TiledTileLayer =>
  layer.type === 'tilelayer';

const isObjectLayer = (layer: TiledLayer): layer is TiledObjectLayer =>
  layer.type === 'objectgroup';

const isGroupLayer = (layer: TiledLayer): layer is TiledGroupLayer =>
  layer.type === 'group';

const hasCollisionMarkerData = (
  name: string,
  properties: TiledProperty[] | undefined,
): boolean => {
  const normalizedName = name.trim().toLowerCase();
  return (
    normalizedName === 'collision' ||
    normalizedName === 'collisions' ||
    normalizedName === 'obstacles' ||
    propertyValue(properties, 'collision') === true
  );
};

const validateTileset = (tileset: unknown): tileset is TiledTilesetReference => {
  if (!isRecord(tileset) || !Number.isInteger(tileset.firstgid) || Number(tileset.firstgid) <= 0) {
    return false;
  }
  if (tileset.source !== undefined) {
    return typeof tileset.source === 'string' && tileset.source.trim().length > 0;
  }
  return (
    typeof tileset.image === 'string' &&
    tileset.image.trim().length > 0 &&
    Number.isInteger(tileset.tilewidth) &&
    Number(tileset.tilewidth) > 0 &&
    Number.isInteger(tileset.tileheight) &&
    Number(tileset.tileheight) > 0 &&
    Number.isInteger(tileset.tilecount) &&
    Number(tileset.tilecount) > 0 &&
    Number.isInteger(tileset.columns) &&
    Number(tileset.columns) > 0
  );
};

const validateLayer = (layer: unknown): TiledLayer => {
  if (
    !isRecord(layer) ||
    typeof layer.name !== 'string' ||
    typeof layer.type !== 'string' ||
    !hasValidLayerAttributes(layer) ||
    !hasValidProperties(layer.properties)
  ) {
    return invalidMap('Every Tiled layer must include string name and type fields.');
  }

  if (layer.type === 'tilelayer') {
    if (
      !Number.isInteger(layer.width) ||
      Number(layer.width) <= 0 ||
      !Number.isInteger(layer.height) ||
      Number(layer.height) <= 0 ||
      !Array.isArray(layer.data) ||
      !layer.data.every((tile) => Number.isInteger(tile) && Number(tile) >= 0)
    ) {
      return invalidMap(`Tile layer ${layer.name} must use an uncompressed integer array.`);
    }

    const expectedLength = Number(layer.width) * Number(layer.height);
    if (layer.data.length !== expectedLength) {
      const properties = layer.properties as TiledProperty[] | undefined;
      if (hasCollisionMarkerData(layer.name, properties)) {
        return invalidMap(
          `Collision tile layer ${layer.name} must contain exactly ${expectedLength} cells.`,
        );
      }

      const normalized = layer.data.slice(0, expectedLength);
      while (normalized.length < expectedLength) normalized.push(0);
      layer.data = normalized;
    }

    return layer as unknown as TiledTileLayer;
  }

  if (layer.type === 'objectgroup') {
    if (!Array.isArray(layer.objects)) {
      return invalidMap(`Object layer ${layer.name} must include an objects array.`);
    }
    for (const object of layer.objects) {
      if (
        !isRecord(object) ||
        (object.name !== undefined && typeof object.name !== 'string') ||
        (object.type !== undefined && typeof object.type !== 'string') ||
        (object.class !== undefined && typeof object.class !== 'string') ||
        (object.x !== undefined && typeof object.x !== 'number') ||
        (object.y !== undefined && typeof object.y !== 'number') ||
        (object.width !== undefined && typeof object.width !== 'number') ||
        (object.height !== undefined && typeof object.height !== 'number') ||
        (object.point !== undefined && typeof object.point !== 'boolean') ||
        !hasValidProperties(object.properties)
      ) {
        return invalidMap(`Object layer ${layer.name} contains a malformed object.`);
      }
    }
    return layer as unknown as TiledObjectLayer;
  }

  if (layer.type === 'group') {
    if (!Array.isArray(layer.layers)) {
      return invalidMap(`Group layer ${layer.name} must include a layers array.`);
    }
    for (const child of layer.layers) {
      validateLayer(child);
    }
    return layer as unknown as TiledGroupLayer;
  }

  return invalidMap(`Unsupported Tiled layer type: ${layer.type}.`);
};

export const parseTiledMap = (input: unknown): TiledMapJson => {
  if (!isRecord(input)) {
    return invalidMap('The Tiled map root must be an object.');
  }

  const { width, height, tilewidth, tileheight, layers, tilesets, type, orientation, infinite } = input;
  if (
    type !== 'map' ||
    orientation !== 'orthogonal' ||
    infinite !== false ||
    !Number.isInteger(width) ||
    Number(width) <= 0 ||
    !Number.isInteger(height) ||
    Number(height) <= 0 ||
    !Number.isInteger(tilewidth) ||
    Number(tilewidth) <= 0 ||
    !Number.isInteger(tileheight) ||
    Number(tileheight) <= 0 ||
    !Array.isArray(layers) ||
    !Array.isArray(tilesets) ||
    tilesets.length === 0 ||
    !tilesets.every(validateTileset) ||
    !hasValidProperties(input.properties)
  ) {
    return invalidMap(
      'Only finite orthogonal Tiled maps with valid dimensions, layers, properties, and tilesets are supported.',
    );
  }

  for (const layer of layers) {
    validateLayer(layer);
  }

  return input as unknown as TiledMapJson;
};

interface LayerVisit {
  layer: TiledLayer;
  pixelOffsetX: number;
  pixelOffsetY: number;
}

const walkLayers = (
  layers: readonly TiledLayer[],
  pixelOffsetX = 0,
  pixelOffsetY = 0,
): LayerVisit[] => {
  const visits: LayerVisit[] = [];
  for (const layer of layers) {
    const nextPixelOffsetX = pixelOffsetX + (layer.offsetx ?? 0);
    const nextPixelOffsetY = pixelOffsetY + (layer.offsety ?? 0);
    if (isGroupLayer(layer)) {
      visits.push(...walkLayers(layer.layers, nextPixelOffsetX, nextPixelOffsetY));
    } else {
      visits.push({ layer, pixelOffsetX: nextPixelOffsetX, pixelOffsetY: nextPixelOffsetY });
    }
  }
  return visits;
};

const hasCollisionMarker = (layer: TiledLayer): boolean =>
  hasCollisionMarkerData(layer.name, layer.properties);

const blockTile = (grid: Uint8Array, map: TiledMapJson, x: number, y: number): void => {
  if (x >= 0 && y >= 0 && x < map.width && y < map.height) {
    grid[y * map.width + x] = 1;
  }
};

const compileTileCollision = (
  grid: Uint8Array,
  map: TiledMapJson,
  layer: TiledTileLayer,
  pixelOffsetX: number,
  pixelOffsetY: number,
): void => {
  if (pixelOffsetX % map.tilewidth !== 0 || pixelOffsetY % map.tileheight !== 0) {
    return invalidMap(`Collision tile layer ${layer.name} must use tile-aligned pixel offsets.`);
  }
  const layerX = (layer.x ?? 0) + pixelOffsetX / map.tilewidth;
  const layerY = (layer.y ?? 0) + pixelOffsetY / map.tileheight;
  for (let localY = 0; localY < layer.height; localY += 1) {
    for (let localX = 0; localX < layer.width; localX += 1) {
      if ((layer.data[localY * layer.width + localX] ?? 0) !== 0) {
        blockTile(grid, map, layerX + localX, layerY + localY);
      }
    }
  }
};

const compileObjectCollision = (
  grid: Uint8Array,
  map: TiledMapJson,
  layer: TiledObjectLayer,
  pixelOffsetX: number,
  pixelOffsetY: number,
): void => {
  for (const object of layer.objects) {
    const left = pixelOffsetX + (object.x ?? 0);
    const top = pixelOffsetY + (object.y ?? 0);
    const width = Math.max(object.width ?? 0, 1);
    const height = Math.max(object.height ?? 0, 1);
    const startX = Math.floor(left / map.tilewidth);
    const startY = Math.floor(top / map.tileheight);
    const endX = Math.ceil((left + width) / map.tilewidth) - 1;
    const endY = Math.ceil((top + height) / map.tileheight) - 1;
    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        blockTile(grid, map, x, y);
      }
    }
  }
};

export const compileCollisionGrid = (map: TiledMapJson): Uint8Array => {
  const collisionSources = walkLayers(map.layers).filter(({ layer }) => hasCollisionMarker(layer));
  if (collisionSources.length === 0) {
    return invalidMap('At least one collision tile or object layer is required.');
  }

  const grid = new Uint8Array(map.width * map.height);
  for (const source of collisionSources) {
    if (isTileLayer(source.layer)) {
      compileTileCollision(
        grid,
        map,
        source.layer,
        source.pixelOffsetX,
        source.pixelOffsetY,
      );
    } else if (isObjectLayer(source.layer)) {
      compileObjectCollision(
        grid,
        map,
        source.layer,
        source.pixelOffsetX,
        source.pixelOffsetY,
      );
    }
  }
  return grid;
};

const objectKind = (object: TiledObject): string =>
  (object.class ?? object.type ?? '').trim().toLowerCase();

export const extractEmbeddedPortals = (map: TiledMapJson): EmbeddedPortalDefinition[] => {
  const portalLayers = walkLayers(map.layers).filter(
    ({ layer }) =>
      isObjectLayer(layer) &&
      (layer.name.toLowerCase() === 'portals' || propertyValue(layer.properties, 'portals') === true),
  );

  const portals: EmbeddedPortalDefinition[] = [];
  for (const visit of portalLayers) {
    const layer = visit.layer as TiledObjectLayer;
    for (const object of layer.objects) {
      const kind = objectKind(object);
      if (kind && kind !== 'portal') {
        continue;
      }
      portals.push({
        sourceX: integerProperty(
          object.properties,
          'sourceX',
          object.x === undefined
            ? undefined
            : Math.floor((visit.pixelOffsetX + object.x) / map.tilewidth),
        ),
        sourceY: integerProperty(
          object.properties,
          'sourceY',
          object.y === undefined
            ? undefined
            : Math.floor((visit.pixelOffsetY + object.y) / map.tileheight),
        ),
        destinationMapKey: stringProperty(object.properties, 'destinationMapKey'),
        targetX: integerProperty(object.properties, 'targetX'),
        targetY: integerProperty(object.properties, 'targetY'),
      });
    }
  }
  return portals;
};

export const extractTiledPoint = (
  map: TiledMapJson,
  objectName: string,
): TiledPointDefinition => {
  const matches: TiledPointDefinition[] = [];
  for (const visit of walkLayers(map.layers)) {
    if (!isObjectLayer(visit.layer)) {
      continue;
    }
    for (const object of visit.layer.objects) {
      if (object.name !== objectName) {
        continue;
      }
      if (object.x === undefined || object.y === undefined) {
        return invalidMap(`Tiled object ${objectName} must define x and y coordinates.`);
      }
      matches.push({
        x: Math.floor((visit.pixelOffsetX + object.x) / map.tilewidth),
        y: Math.floor((visit.pixelOffsetY + object.y) / map.tileheight),
      });
    }
  }
  if (matches.length !== 1) {
    return invalidMap(`Expected exactly one Tiled object named ${objectName}.`);
  }
  return matches[0]!;
};

export const extractMapMetadata = (map: TiledMapJson): TiledMapMetadata => {
  const zoneType = stringProperty(map.properties, 'zoneType').toUpperCase();
  if (zoneType !== 'SAFE' && zoneType !== 'OUTLAW' && zoneType !== 'PVP') {
    return invalidMap('Property zoneType must be SAFE, OUTLAW, or PVP.');
  }
  return {
    key: stringProperty(map.properties, 'key'),
    name: stringProperty(map.properties, 'name'),
    zoneType: zoneType as TiledMapMetadata['zoneType'],
    spawnX: integerProperty(map.properties, 'spawnX'),
    spawnY: integerProperty(map.properties, 'spawnY'),
    isDefault: booleanProperty(map.properties, 'default', false),
  };
};
