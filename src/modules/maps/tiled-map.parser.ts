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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasValidProperties = (value: unknown): value is TiledProperty[] | undefined =>
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

const integerProperty = (
  object: TiledObject,
  name: string,
  fallback?: number,
): number => {
  const value = propertyValue(object.properties, name) ?? fallback;
  if (!Number.isInteger(value)) {
    throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', {
      reason: `Portal property ${name} must be an integer.`,
    });
  }
  return Number(value);
};

const stringProperty = (object: TiledObject, name: string): string => {
  const value = propertyValue(object.properties, name);
  if (typeof value !== 'string' || value.length === 0) {
    throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', {
      reason: `Portal property ${name} must be a non-empty string.`,
    });
  }
  return value;
};

const isTileLayer = (layer: TiledLayer): layer is TiledTileLayer =>
  isRecord(layer) && layer.type === 'tilelayer';

const isObjectLayer = (layer: TiledLayer): layer is TiledObjectLayer =>
  isRecord(layer) && layer.type === 'objectgroup';

export const parseTiledMap = (input: unknown): TiledMapJson => {
  if (!isRecord(input)) {
    throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', {
      reason: 'The Tiled map root must be an object.',
    });
  }

  const { width, height, tilewidth, tileheight, layers, type } = input;
  if (
    type !== 'map' ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    !Number.isInteger(tilewidth) ||
    !Number.isInteger(tileheight) ||
    !Array.isArray(layers) ||
    Number(width) <= 0 ||
    Number(height) <= 0 ||
    Number(tilewidth) <= 0 ||
    Number(tileheight) <= 0 ||
    !hasValidProperties(input.properties)
  ) {
    throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', {
      reason: 'The Tiled map dimensions or layer collection are invalid.',
    });
  }

  for (const layer of layers) {
    if (
      !isRecord(layer) ||
      typeof layer.name !== 'string' ||
      typeof layer.type !== 'string' ||
      !hasValidProperties(layer.properties)
    ) {
      throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', {
        reason: 'Every Tiled layer must include string name and type fields.',
      });
    }
    if (layer.type === 'tilelayer') {
      if (
        !Number.isInteger(layer.width) ||
        !Number.isInteger(layer.height) ||
        !Array.isArray(layer.data) ||
        !layer.data.every((tile) => Number.isInteger(tile) && Number(tile) >= 0)
      ) {
        throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', {
          reason: `Tile layer ${layer.name} is malformed.`,
        });
      }
    }
    if (layer.type === 'objectgroup') {
      if (!Array.isArray(layer.objects)) {
        throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', {
          reason: `Object layer ${layer.name} must include an objects array.`,
        });
      }
      for (const object of layer.objects) {
        if (
          !isRecord(object) ||
          (object.type !== undefined && typeof object.type !== 'string') ||
          (object.x !== undefined && typeof object.x !== 'number') ||
          (object.y !== undefined && typeof object.y !== 'number') ||
          !hasValidProperties(object.properties)
        ) {
          throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', {
            reason: `Object layer ${layer.name} contains a malformed object.`,
          });
        }
      }
    }
  }

  return input as unknown as TiledMapJson;
};

export const compileCollisionGrid = (map: TiledMapJson): Uint8Array => {
  const collisionLayers = map.layers.filter((layer): layer is TiledTileLayer => {
    if (!isTileLayer(layer)) {
      return false;
    }
    const name = layer.name.toLowerCase();
    return (
      name === 'collision' ||
      name === 'obstacles' ||
      propertyValue(layer.properties, 'collision') === true
    );
  });

  if (collisionLayers.length === 0) {
    throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', {
      reason: 'At least one collision tile layer is required.',
    });
  }

  const tileCount = map.width * map.height;
  const grid = new Uint8Array(tileCount);
  for (const layer of collisionLayers) {
    if (layer.width !== map.width || layer.height !== map.height || layer.data.length !== tileCount) {
      throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', {
        reason: `Collision layer ${layer.name} dimensions do not match the map.`,
      });
    }

    for (let index = 0; index < tileCount; index += 1) {
      if ((layer.data[index] ?? 0) !== 0) {
        grid[index] = 1;
      }
    }
  }
  return grid;
};

export const extractEmbeddedPortals = (map: TiledMapJson): EmbeddedPortalDefinition[] => {
  const portalLayers = map.layers.filter(
    (layer): layer is TiledObjectLayer =>
      isObjectLayer(layer) &&
      (layer.name.toLowerCase() === 'portals' || propertyValue(layer.properties, 'portals') === true),
  );

  const portals: EmbeddedPortalDefinition[] = [];
  for (const layer of portalLayers) {
    for (const object of layer.objects) {
      if (object.type && object.type.toLowerCase() !== 'portal') {
        continue;
      }
      const sourceX = integerProperty(
        object,
        'sourceX',
        object.x === undefined ? undefined : Math.floor(object.x / map.tilewidth),
      );
      const sourceY = integerProperty(
        object,
        'sourceY',
        object.y === undefined ? undefined : Math.floor(object.y / map.tileheight),
      );
      portals.push({
        sourceX,
        sourceY,
        destinationMapKey: stringProperty(object, 'destinationMapKey'),
        targetX: integerProperty(object, 'targetX'),
        targetY: integerProperty(object, 'targetY'),
      });
    }
  }

  return portals;
};
