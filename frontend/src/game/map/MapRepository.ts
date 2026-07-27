import type { LoadedMapDefinition } from '../../contracts/tiled';
import { fetchJsonResource, publicAssetUrl } from '../../utils/httpJson';
import { compileMapDefinition, parseTiledMap } from './tiledMap';

const assetCacheMode: RequestCache = import.meta.env.DEV ? 'no-store' : 'force-cache';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isCollisionLayer = (layer: Record<string, unknown>): boolean => {
  const normalizedName = typeof layer.name === 'string' ? layer.name.trim().toLowerCase() : '';
  if (normalizedName === 'collision' || normalizedName === 'collisions' || normalizedName === 'obstacles') {
    return true;
  }

  return (
    Array.isArray(layer.properties) &&
    layer.properties.some(
      (property) =>
        isRecord(property) &&
        property.name === 'collision' &&
        property.value === true,
    )
  );
};

const normalizeTileLayer = (
  layer: Record<string, unknown>,
  mapWidth: number,
  mapHeight: number,
): Record<string, unknown> => {
  if (layer.type === 'group' && Array.isArray(layer.layers)) {
    return {
      ...layer,
      layers: layer.layers.map((child) =>
        isRecord(child) ? normalizeTileLayer(child, mapWidth, mapHeight) : child,
      ),
    };
  }

  if (layer.type !== 'tilelayer' || isCollisionLayer(layer) || !Array.isArray(layer.data)) {
    return layer;
  }

  const width = Number.isInteger(layer.width) && Number(layer.width) > 0 ? Number(layer.width) : mapWidth;
  const height = Number.isInteger(layer.height) && Number(layer.height) > 0 ? Number(layer.height) : mapHeight;
  const expectedLength = width * height;
  const sanitized = layer.data.map((value) => (Number.isInteger(value) ? Number(value) : 0));

  if (sanitized.length === expectedLength) {
    return sanitized.every((value, index) => value === layer.data[index])
      ? layer
      : { ...layer, data: sanitized };
  }

  const normalized = sanitized.slice(0, expectedLength);
  while (normalized.length < expectedLength) {
    normalized.push(0);
  }

  console.warn(
    `Normalized visual Tiled layer ${String(layer.name ?? '<unnamed>')} from ${sanitized.length} to ${expectedLength} cells.`,
  );

  return { ...layer, width, height, data: normalized };
};

const normalizeVisualTileLayers = (input: unknown): unknown => {
  if (
    !isRecord(input) ||
    !Number.isInteger(input.width) ||
    !Number.isInteger(input.height) ||
    !Array.isArray(input.layers)
  ) {
    return input;
  }

  const mapWidth = Number(input.width);
  const mapHeight = Number(input.height);
  return {
    ...input,
    layers: input.layers.map((layer) =>
      isRecord(layer) ? normalizeTileLayer(layer, mapWidth, mapHeight) : layer,
    ),
  };
};

class MapRepository {
  private readonly cache = new Map<string, Promise<LoadedMapDefinition>>();

  load(key: string): Promise<LoadedMapDefinition> {
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    const url = publicAssetUrl(`maps/${encodeURIComponent(key)}.json`);
    const loading = fetchJsonResource(url, `Map ${key}`, { cache: assetCacheMode })
      .then(normalizeVisualTileLayers)
      .then(parseTiledMap)
      .then((source) => compileMapDefinition(key, source, url))
      .catch((error: unknown) => {
        this.cache.delete(key);
        throw error;
      });

    this.cache.set(key, loading);
    return loading;
  }

  prime(key: string, map: LoadedMapDefinition): void {
    this.cache.set(key, Promise.resolve(map));
  }
}

export const mapRepository = new MapRepository();
