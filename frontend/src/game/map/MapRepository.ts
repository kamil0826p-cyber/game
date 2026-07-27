import type { LoadedMapDefinition } from '../../contracts/tiled';
import { compileMapDefinition, decodeTiledMapPayload, parseTiledMap } from './tiledMap';

const mapUrls: Readonly<Record<string, string>> = {
  greenfields: '/maps/greenfields.json',
  'crystal-cave': '/maps/crystal-cave.json',
};

class MapRepository {
  private readonly cache = new Map<string, Promise<LoadedMapDefinition>>();

  load(key: string, version = 0): Promise<LoadedMapDefinition> {
    const cacheKey = `${key}:${version}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const url = mapUrls[key] ?? `/maps/${encodeURIComponent(key)}.json`;
    const versionedUrl = `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(String(version))}`;
    const loading = fetch(versionedUrl, { cache: 'no-cache' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Map ${key} could not be loaded (${response.status}).`);
        return response.json() as Promise<unknown>;
      })
      .then(decodeTiledMapPayload)
      .then(parseTiledMap)
      .then((source) => compileMapDefinition(key, source))
      .catch((error: unknown) => {
        this.cache.delete(cacheKey);
        throw error;
      });

    this.cache.set(cacheKey, loading);
    return loading;
  }

  prime(key: string, map: LoadedMapDefinition, version = 0): void {
    this.cache.set(`${key}:${version}`, Promise.resolve(map));
  }
}

export const mapRepository = new MapRepository();
