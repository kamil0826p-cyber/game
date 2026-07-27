import type { LoadedMapDefinition } from '../../contracts/tiled';
import { compileMapDefinition, parseTiledMap } from './tiledMap';

const absoluteMapUrl = (url: string): string =>
  typeof window === 'undefined' ? url : new URL(url, window.location.href).toString();

class MapRepository {
  private readonly cache = new Map<string, Promise<LoadedMapDefinition>>();

  load(key: string): Promise<LoadedMapDefinition> {
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    const url = `/maps/${encodeURIComponent(key)}.json`;
    const loading = fetch(url, { cache: 'force-cache' })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Map ${key} could not be loaded (${response.status}).`);
        }
        return response.json() as Promise<unknown>;
      })
      .then(parseTiledMap)
      .then((source) => compileMapDefinition(key, source, absoluteMapUrl(url)))
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
