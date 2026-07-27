import type {
  ClientPortal,
  LoadedMapDefinition,
  RenderedTileLayer,
  TiledGroupLayer,
  TiledLayer,
  TiledMapJson,
  TiledObject,
  TiledObjectLayer,
  TiledProperty,
  TiledTileLayer,
  TiledTilesetReference,
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
  return value.trim();
};

const isTileLayer = (layer: TiledLayer): layer is TiledTileLayer =>
  layer.type === 'tilelayer';

const isObjectLayer = (layer: TiledLayer): layer is TiledObjectLayer =>
  layer.type === 'objectgroup';

const isGroupLayer = (layer: TiledLayer): layer is TiledGroupLayer =>
  layer.type === 'group';

const isTilesetReference = (tileset: unknown): tileset is TiledTilesetReference => {
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
    !isPropertyArray(layer.properties)
  ) {
    throw new Error('Every Tiled layer must include string name and type fields.');
  }

  if (layer.type === 'tilelayer') {
    if (
      !Number.isInteger(layer.width) ||
      Number(layer.width) <= 0 ||
      !Number.isInteger(layer.height) ||
      Number(layer.height) <= 0 ||
      !Array.isArray(layer.data) ||
      layer.data.length !== Number(layer.width) * Number(layer.height) ||
      !layer.data.every((tile) => Number.isInteger(tile) && Number(tile) >= 0)
    ) {
      throw new Error(
        `Tile layer ${layer.name} must use an uncompressed integer array matching its dimensions.`,
      );
    }
    return layer as unknown as TiledTileLayer;
  }

  if (layer.type === 'objectgroup') {
    if (!Array.isArray(layer.objects)) {
      throw new Error(`Object layer ${layer.name} must contain an objects array.`);
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
        !isPropertyArray(object.properties)
      ) {
        throw new Error(`Object layer ${layer.name} contains malformed data.`);
      }
    }
    return layer as unknown as TiledObjectLayer;
  }

  if (layer.type === 'group') {
    if (!Array.isArray(layer.layers)) {
      throw new Error(`Group layer ${layer.name} must contain a layers array.`);
    }
    for (const child of layer.layers) {
      validateLayer(child);
    }
    return layer as unknown as TiledGroupLayer;
  }

  throw new Error(`Unsupported Tiled layer type: ${layer.type}.`);
};

export const parseTiledMap = (input: unknown): TiledMapJson => {
  if (!isRecord(input)) {
    throw new Error('The Tiled map root must be an object.');
  }

  const { type, orientation, infinite, width, height, tilewidth, tileheight, layers, tilesets } = input;
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
    !tilesets.every(isTilesetReference) ||
    !isPropertyArray(input.properties)
  ) {
    throw new Error(
      'Only finite orthogonal Tiled maps with valid dimensions, layers, properties, and tilesets are supported.',
    );
  }

  for (const layer of layers) {
    validateLayer(layer);
  }

  return input as unknown as TiledMapJson;
};

interface LayerContext {
  pixelOffsetX: number;
  pixelOffsetY: number;
  opacity: number;
  visible: boolean;
}

interface LayerVisit extends LayerContext {
  layer: TiledTileLayer | TiledObjectLayer;
}

const walkLayers = (
  layers: readonly TiledLayer[],
  context: LayerContext = { pixelOffsetX: 0, pixelOffsetY: 0, opacity: 1, visible: true },
): LayerVisit[] => {
  const visits: LayerVisit[] = [];
  for (const layer of layers) {
    const nextContext: LayerContext = {
      pixelOffsetX: context.pixelOffsetX + (layer.offsetx ?? 0),
      pixelOffsetY: context.pixelOffsetY + (layer.offsety ?? 0),
      opacity: context.opacity * (layer.opacity ?? 1),
      visible: context.visible && layer.visible !== false,
    };
    if (isGroupLayer(layer)) {
      visits.push(...walkLayers(layer.layers, nextContext));
    } else {
      visits.push({ layer, ...nextContext });
    }
  }
  return visits;
};

const hasCollisionMarker = (layer: TiledLayer): boolean => {
  const normalizedName = layer.name.toLowerCase();
  return (
    normalizedName === 'collision' ||
    normalizedName === 'collisions' ||
    normalizedName === 'obstacles' ||
    propertyValue(layer.properties, 'collision') === true
  );
};

const blockTile = (collision: Uint8Array, map: TiledMapJson, x: number, y: number): void => {
  if (x >= 0 && y >= 0 && x < map.width && y < map.height) {
    collision[y * map.width + x] = 1;
  }
};

const compileCollision = (map: TiledMapJson): Uint8Array => {
  const collisionSources = walkLayers(map.layers).filter(({ layer }) => hasCollisionMarker(layer));
  if (collisionSources.length === 0) {
    throw new Error('The map must include at least one collision tile or object layer.');
  }

  const collision = new Uint8Array(map.width * map.height);
  for (const visit of collisionSources) {
    const { layer } = visit;
    if (isTileLayer(layer)) {
      if (
        visit.pixelOffsetX % map.tilewidth !== 0 ||
        visit.pixelOffsetY % map.tileheight !== 0
      ) {
        throw new Error(`Collision tile layer ${layer.name} must use tile-aligned pixel offsets.`);
      }
      const layerX = (layer.x ?? 0) + visit.pixelOffsetX / map.tilewidth;
      const layerY = (layer.y ?? 0) + visit.pixelOffsetY / map.tileheight;
      for (let localY = 0; localY < layer.height; localY += 1) {
        for (let localX = 0; localX < layer.width; localX += 1) {
          if ((layer.data[localY * layer.width + localX] ?? 0) !== 0) {
            blockTile(collision, map, layerX + localX, layerY + localY);
          }
        }
      }
    } else {
      for (const object of layer.objects) {
        const left = visit.pixelOffsetX + (object.x ?? 0);
        const top = visit.pixelOffsetY + (object.y ?? 0);
        const width = Math.max(object.width ?? 0, 1);
        const height = Math.max(object.height ?? 0, 1);
        const startX = Math.floor(left / map.tilewidth);
        const startY = Math.floor(top / map.tileheight);
        const endX = Math.ceil((left + width) / map.tilewidth) - 1;
        const endY = Math.ceil((top + height) / map.tileheight) - 1;
        for (let y = startY; y <= endY; y += 1) {
          for (let x = startX; x <= endX; x += 1) {
            blockTile(collision, map, x, y);
          }
        }
      }
    }
  }
  return collision;
};

const extractPortals = (map: TiledMapJson): ClientPortal[] => {
  const portalLayers = walkLayers(map.layers).filter(
    ({ layer }) =>
      isObjectLayer(layer) &&
      (layer.name.toLowerCase() === 'portals' || propertyValue(layer.properties, 'portals') === true),
  );

  const portals: ClientPortal[] = [];
  for (const visit of portalLayers) {
    const layer = visit.layer as TiledObjectLayer;
    for (const object of layer.objects) {
      const kind = (object.class ?? object.type ?? '').trim().toLowerCase();
      if (kind && kind !== 'portal') {
        continue;
      }
      portals.push({
        sourceX: integerProperty(
          object,
          'sourceX',
          object.x === undefined
            ? undefined
            : Math.floor((visit.pixelOffsetX + object.x) / map.tilewidth),
        ),
        sourceY: integerProperty(
          object,
          'sourceY',
          object.y === undefined
            ? undefined
            : Math.floor((visit.pixelOffsetY + object.y) / map.tileheight),
        ),
        destinationMapKey: stringProperty(object, 'destinationMapKey'),
        targetX: integerProperty(object, 'targetX'),
        targetY: integerProperty(object, 'targetY'),
      });
    }
  }
  return portals;
};

const compileRenderLayers = (map: TiledMapJson): RenderedTileLayer[] =>
  walkLayers(map.layers)
    .filter(
      (visit): visit is LayerVisit & { layer: TiledTileLayer } =>
        isTileLayer(visit.layer) &&
        visit.visible &&
        visit.opacity > 0 &&
        !hasCollisionMarker(visit.layer) &&
        propertyValue(visit.layer.properties, 'render') !== false,
    )
    .map(({ layer, pixelOffsetX, pixelOffsetY, opacity }) => ({
      name: layer.name,
      width: layer.width,
      height: layer.height,
      data: layer.data,
      tileOffsetX: layer.x ?? 0,
      tileOffsetY: layer.y ?? 0,
      pixelOffsetX,
      pixelOffsetY,
      opacity,
    }));

export const compileMapDefinition = (
  key: string,
  source: TiledMapJson,
  sourceUrl = `/maps/${encodeURIComponent(key)}.json`,
): LoadedMapDefinition => {
  const renderLayers = compileRenderLayers(source);
  if (renderLayers.length === 0) {
    throw new Error(`Map ${key} must include at least one visible tile layer.`);
  }

  return {
    key,
    sourceUrl,
    source,
    width: source.width,
    height: source.height,
    tileWidth: source.tilewidth,
    tileHeight: source.tileheight,
    renderLayers,
    collision: compileCollision(source),
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
