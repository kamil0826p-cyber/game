import type { LoadedMapDefinition, TiledMapJson } from '../../contracts/tiled';
import { compileMapDefinition, parseTiledMap } from './tiledMap';

const absoluteMapUrl = (url: string): string =>
  typeof window === 'undefined' ? url : new URL(url, window.location.href).toString();

const contentVersion = (source: TiledMapJson): string | undefined => {
  const value = source.properties?.find((property) => property.name === 'contentVersion')?.value;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
};

const versionedSourceUrl = (url: string, source: TiledMapJson): string => {
  const absolute = new URL(absoluteMapUrl(url));
  const version = contentVersion(source);
  if (version) {
    absolute.searchParams.set('v', version);
  }
  return absolute.toString();
};

class MapRepository {
  private readonly cache = new Map<string, Promise<LoadedMapDefinition>>();

  load(key: string): Promise<LoadedMapDefinition> {
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    const url = `/maps/${encodeURIComponent(key)}.json`;
    const loading = fetch(url, { cache: 'no-cache' })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Map ${key} could not be loaded (${response.status}).`);
        }
        return response.json() as Promise<unknown>;
      })
      .then(parseTiledMap)
      .then((source) => compileMapDefinition(key, source, versionedSourceUrl(url, source)))
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

  invalidate(key?: string): void {
    if (key) {
      this.cache.delete(key);
      return;
    }
    this.cache.clear();
  }
}

export const mapRepository = new MapRepository();
