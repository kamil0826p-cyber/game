import type { LoadedMapDefinition } from '../../contracts/tiled';
import { compileMapDefinition, decodeTiledMapPayload, parseTiledMap } from './tiledMap';

const mapUrls: Readonly<Record<string, string>> = {
  greenfields: '/maps/greenfields.json',
  'crystal-cave': '/maps/crystal-cave.json',
  'ashen-infirmary': '/maps/ashen-infirmary.json',
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const appendVersion = (url: string, version: number): string => `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(String(version))}`;

const resolveExternalTilesets = async (input: unknown, mapUrl: string, version: number): Promise<unknown> => {
  if (!isRecord(input) || !Array.isArray(input.tilesets)) return input;
  const tilesets = await Promise.all(input.tilesets.map(async (tileset) => {
    if (!isRecord(tileset)) return tileset;
    if (typeof tileset.source !== 'string' || !tileset.source.trim()) return { ...tileset, resolvedSourceUrl: mapUrl };
    const sourceUrl = appendVersion(new URL(tileset.source, new URL(mapUrl, window.location.origin)).toString(), version);
    const response = await fetch(sourceUrl, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`Tileset ${tileset.source} could not be loaded (${response.status}).`);
    let external: unknown;
    try {
      external = await response.json();
    } catch {
      throw new Error(`Tileset ${tileset.source} must be exported as Tiled JSON (.tsj), not TSX/XML.`);
    }
    if (!isRecord(external)) throw new Error(`Tileset ${tileset.source} is malformed.`);
    return { ...external, firstgid: tileset.firstgid, source: tileset.source, resolvedSourceUrl: sourceUrl };
  }));
  return { ...input, tilesets };
};

class MapRepository {
  private readonly cache = new Map<string, Promise<LoadedMapDefinition>>();

  load(key: string, version = 0): Promise<LoadedMapDefinition> {
    const cacheKey = `${key}:${version}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const url = mapUrls[key] ?? `/maps/${encodeURIComponent(key)}.json`;
    const versionedUrl = appendVersion(url, version);
    const loading = fetch(versionedUrl, { cache: 'no-cache' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Map ${key} could not be loaded (${response.status}).`);
        return response.json() as Promise<unknown>;
      })
      .then((source) => resolveExternalTilesets(source, versionedUrl, version))
      .then(decodeTiledMapPayload)
      .then(parseTiledMap)
      .then((source) => compileMapDefinition(key, source, versionedUrl))
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
