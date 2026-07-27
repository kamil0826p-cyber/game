import { Assets, Rectangle, Texture } from 'pixi.js';
import type { CharacterClass, Direction } from '../../contracts/game';
import type {
  LoadedMapDefinition,
  TiledTilesetJson,
  TiledTilesetReference,
} from '../../contracts/tiled';

export interface OutfitAssetDefinition {
  image: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  framesPerDirection: number;
  frameDurationMs: number;
  directionRows: Record<Direction, number>;
  characterClass: CharacterClass;
  unlockLevel: number;
}

export interface AssetManifest {
  version: number;
  outfits: Record<string, OutfitAssetDefinition>;
}

export interface OutfitFrames {
  definition: OutfitAssetDefinition;
  frames: Record<Direction, Texture[]>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseTileset = (input: unknown, label: string): TiledTilesetJson => {
  if (
    !isRecord(input) ||
    !Number.isInteger(input.tilewidth) ||
    Number(input.tilewidth) <= 0 ||
    !Number.isInteger(input.tileheight) ||
    Number(input.tileheight) <= 0 ||
    !Number.isInteger(input.tilecount) ||
    Number(input.tilecount) <= 0 ||
    !Number.isInteger(input.columns) ||
    Number(input.columns) < 0
  ) {
    throw new Error(`Tiled tileset ${label} is malformed.`);
  }

  const hasAtlas = typeof input.image === 'string' && input.image.trim().length > 0;
  const hasImageCollection =
    Array.isArray(input.tiles) &&
    input.tiles.length > 0 &&
    input.tiles.every(
      (tile) =>
        isRecord(tile) &&
        Number.isInteger(tile.id) &&
        Number(tile.id) >= 0 &&
        typeof tile.image === 'string' &&
        tile.image.trim().length > 0,
    );
  if (!hasAtlas && !hasImageCollection) {
    throw new Error(`Tiled tileset ${label} must define an atlas image or tile images.`);
  }
  return input as unknown as TiledTilesetJson;
};

const inlineTileset = (reference: TiledTilesetReference): TiledTilesetJson =>
  parseTileset(reference, 'inline tileset');

const inheritedVersion = (baseUrl: string): string | undefined => {
  try {
    return new URL(baseUrl).searchParams.get('v') ?? undefined;
  } catch {
    return undefined;
  }
};

const versionedUrl = (relative: string, baseUrl: string): string => {
  const url = new URL(relative, baseUrl);
  const version = inheritedVersion(baseUrl);
  if (version) {
    url.searchParams.set('v', version);
  }
  return url.toString();
};

class GameAssetLoader {
  private manifestPromise?: Promise<AssetManifest>;
  private readonly tileTextureCache = new Map<
    string,
    Promise<Map<number, Texture> | undefined>
  >();
  private readonly outfitTextureCache = new Map<string, Promise<OutfitFrames | undefined>>();

  loadManifest(): Promise<AssetManifest> {
    if (!this.manifestPromise) {
      this.manifestPromise = fetch('/assets/manifest.json', { cache: 'no-cache' }).then(
        async (response) => {
          if (!response.ok) {
            throw new Error(`Asset manifest failed to load (${response.status}).`);
          }
          return response.json() as Promise<AssetManifest>;
        },
      );
    }
    return this.manifestPromise;
  }

  getTileTextures(map: LoadedMapDefinition): Promise<Map<number, Texture> | undefined> {
    const cacheKey = map.sourceUrl;
    const cached = this.tileTextureCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const loading = Promise.all(
      map.source.tilesets.map(async (reference) => {
        if (reference.source) {
          const tilesetUrl = versionedUrl(reference.source, map.sourceUrl);
          const response = await fetch(tilesetUrl, { cache: 'no-cache' });
          if (!response.ok) {
            throw new Error(`Tiled tileset ${reference.source} failed to load (${response.status}).`);
          }
          return {
            firstGid: reference.firstgid,
            definition: parseTileset(await response.json(), reference.source),
            baseUrl: tilesetUrl,
          };
        }
        return {
          firstGid: reference.firstgid,
          definition: inlineTileset(reference),
          baseUrl: map.sourceUrl,
        };
      }),
    )
      .then(async (tilesets) => {
        const textures = new Map<number, Texture>();
        await Promise.all(
          tilesets.map(async ({ firstGid, definition, baseUrl }) => {
            if (definition.tiles && definition.tiles.length > 0) {
              await Promise.all(
                definition.tiles.map(async (tile) => {
                  const imageUrl = versionedUrl(tile.image, baseUrl);
                  const texture = await Assets.load<Texture>(imageUrl);
                  texture.source.scaleMode = 'nearest';
                  textures.set(firstGid + tile.id, texture);
                }),
              );
              return;
            }

            if (!definition.image || definition.columns <= 0) {
              throw new Error('Atlas tileset is missing its image or columns.');
            }
            const imageUrl = versionedUrl(definition.image, baseUrl);
            const baseTexture = await Assets.load<Texture>(imageUrl);
            baseTexture.source.scaleMode = 'nearest';
            const margin = definition.margin ?? 0;
            const spacing = definition.spacing ?? 0;
            for (let localId = 0; localId < definition.tilecount; localId += 1) {
              const column = localId % definition.columns;
              const row = Math.floor(localId / definition.columns);
              textures.set(
                firstGid + localId,
                new Texture({
                  source: baseTexture.source,
                  frame: new Rectangle(
                    margin + column * (definition.tilewidth + spacing),
                    margin + row * (definition.tileheight + spacing),
                    definition.tilewidth,
                    definition.tileheight,
                  ),
                }),
              );
            }
          }),
        );
        return textures;
      })
      .catch((error: unknown) => {
        this.tileTextureCache.delete(cacheKey);
        console.error('Tiled texture loading failed.', error);
        return undefined;
      });

    this.tileTextureCache.set(cacheKey, loading);
    return loading;
  }

  getOutfitFrames(outfitKey: string): Promise<OutfitFrames | undefined> {
    const cached = this.outfitTextureCache.get(outfitKey);
    if (cached) {
      return cached;
    }
    const loading = this.loadManifest()
      .then(async (manifest) => {
        const definition = manifest.outfits[outfitKey];
        if (!definition) {
          return undefined;
        }
        const baseTexture = await Assets.load<Texture>(definition.image);
        baseTexture.source.scaleMode = 'nearest';
        const directions = Object.keys(definition.directionRows) as Direction[];
        const frames = Object.fromEntries(
          directions.map((direction) => {
            const row = definition.directionRows[direction];
            const directionFrames = Array.from(
              { length: definition.framesPerDirection },
              (_, column) =>
                new Texture({
                  source: baseTexture.source,
                  frame: new Rectangle(
                    column * definition.frameWidth,
                    row * definition.frameHeight,
                    definition.frameWidth,
                    definition.frameHeight,
                  ),
                }),
            );
            return [direction, directionFrames];
          }),
        ) as unknown as Record<Direction, Texture[]>;
        return { definition, frames };
      })
      .catch(() => undefined);
    this.outfitTextureCache.set(outfitKey, loading);
    return loading;
  }
}

export const gameAssetLoader = new GameAssetLoader();
