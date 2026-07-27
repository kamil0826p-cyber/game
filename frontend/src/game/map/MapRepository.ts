import type { LoadedMapDefinition } from '../../contracts/tiled';
import { fetchJsonResource, publicAssetUrl } from '../../utils/httpJson';
import { compileMapDefinition, parseTiledMap } from './tiledMap';

class MapRepository {
  private readonly cache = new Map<string, Promise<LoadedMapDefinition>>();

  load(key: string): Promise<LoadedMapDefinition> {
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    const url = publicAssetUrl(`maps/${encodeURIComponent(key)}.json`);
    const loading = fetchJsonResource(url, `Map ${key}`, { cache: 'force-cache' })
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
