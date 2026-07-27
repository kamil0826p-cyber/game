import { Assets, Rectangle, Texture } from 'pixi.js';
import type { CharacterClass, Direction } from '../../contracts/game';
import type {
  LoadedMapDefinition,
  TiledTileDefinition,
  TiledTilesetJson,
  TiledTilesetReference,
} from '../../contracts/tiled';
import { fetchJsonResource, publicAssetUrl } from '../../utils/httpJson';

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

const assetCacheMode: RequestCache = import.meta.env.DEV ? 'no-store' : 'force-cache';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPositiveInteger = (value: unknown): boolean =>
  Number.isInteger(value) && Number(value) > 0;

const parseTileDefinition = (
  input: unknown,
  label: string,
  requireImage: boolean,
): TiledTileDefinition => {
  if (!isRecord(input) || !Number.isInteger(input.id) || Number(input.id) < 0) {
    throw new Error(`Tiled tile ${label} is malformed.`);
  }
  if (requireImage && (typeof input.image !== 'string' || input.image.trim().length === 0)) {
    throw new Error(`Tiled collection tile ${label} does not define an image.`);
  }
  return input as unknown as TiledTileDefinition;
};

const parseTileset = (input: unknown, label: string): TiledTilesetJson => {
  if (
    !isRecord(input) ||
    !isPositiveInteger(input.tilewidth) ||
    !isPositiveInteger(input.tileheight) ||
    !isPositiveInteger(input.tilecount) ||
    !Number.isInteger(input.columns) ||
    Number(input.columns) < 0
  ) {
    throw new Error(`Tiled tileset ${label} is malformed.`);
  }

  const hasAtlasImage = typeof input.image === 'string' && input.image.trim().length > 0;
  if (hasAtlasImage && Number(input.columns) <= 0) {
    throw new Error(`Tiled atlas tileset ${label} must define at least one column.`);
  }
  if (input.tiles !== undefined && !Array.isArray(input.tiles)) {
    throw new Error(`Tiled tileset ${label} has a malformed tiles array.`);
  }

  const tiles = (input.tiles ?? []).map((tile, index) =>
    parseTileDefinition(tile, `${label}#${index}`, !hasAtlasImage),
  );
  if (!hasAtlasImage && tiles.length === 0) {
    throw new Error(`Tiled tileset ${label} defines neither an atlas nor tile images.`);
  }

  const ids = new Set<number>();
  for (const tile of tiles) {
    if (ids.has(tile.id)) {
      throw new Error(`Tiled tileset ${label} contains duplicate tile id ${tile.id}.`);
    }
    ids.add(tile.id);
  }

  return input as unknown as TiledTilesetJson;
};

const inlineTileset = (reference: TiledTilesetReference): TiledTilesetJson =>
  parseTileset(reference, 'inline tileset');

const canonicalTilesetSource = (source: string): string => {
  if (!source.toLowerCase().endsWith('.tsx')) return source;
  const filename = source.split('/').at(-1)?.replace(/\.tsx$/i, '.tsj') ?? source;
  return `tilesets/${filename}`;
};

const loadAtlasTextures = async (
  textures: Map<number, Texture>,
  firstGid: number,
  definition: TiledTilesetJson,
  baseUrl: string,
): Promise<void> => {
  if (!definition.image) return;
  const imageUrl = new URL(definition.image, baseUrl).toString();
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
};

const loadCollectionTextures = async (
  textures: Map<number, Texture>,
  firstGid: number,
  definition: TiledTilesetJson,
  baseUrl: string,
): Promise<void> => {
  if (definition.image) return;
  await Promise.all(
    (definition.tiles ?? []).map(async (tile) => {
      if (!tile.image) {
        throw new Error(`Tiled collection tile ${tile.id} does not define an image.`);
      }
      const imageUrl = new URL(tile.image, baseUrl).toString();
      const texture = await Assets.load<Texture>(imageUrl);
      texture.source.scaleMode = 'nearest';
      textures.set(firstGid + tile.id, texture);
    }),
  );
};

class GameAssetLoader {
  private manifestPromise?: Promise<AssetManifest>;
  private readonly tileTextureCache = new Map<string, Promise<Map<number, Texture>>>();
  private readonly outfitTextureCache = new Map<string, Promise<OutfitFrames | undefined>>();

  loadManifest(): Promise<AssetManifest> {
    if (!this.manifestPromise) {
      const manifestUrl = publicAssetUrl('assets/manifest.json');
      this.manifestPromise = fetchJsonResource(manifestUrl, 'Asset manifest', {
        cache: assetCacheMode,
      }).then((value) => value as AssetManifest);
    }
    return this.manifestPromise;
  }

  getTileTextures(map: LoadedMapDefinition): Promise<Map<number, Texture>> {
    const cached = this.tileTextureCache.get(map.sourceUrl);
    if (cached) return cached;

    const loading = Promise.all(
      map.source.tilesets.map(async (reference) => {
        if (reference.source) {
          const source = canonicalTilesetSource(reference.source);
          const tilesetUrl = new URL(source, map.sourceUrl).toString();
          const definition = parseTileset(
            await fetchJsonResource(tilesetUrl, `Tiled tileset ${source}`, {
              cache: assetCacheMode,
            }),
            source,
          );
          return { firstGid: reference.firstgid, definition, baseUrl: tilesetUrl };
        }
        return {
          firstGid: reference.firstgid,
          definition: inlineTileset(reference),
          baseUrl: map.sourceUrl,
        };
      }),
    ).then(async (tilesets) => {
      const textures = new Map<number, Texture>();
      await Promise.all(
        tilesets.map(async ({ firstGid, definition, baseUrl }) => {
          await loadAtlasTextures(textures, firstGid, definition, baseUrl);
          await loadCollectionTextures(textures, firstGid, definition, baseUrl);
        }),
      );
      if (textures.size === 0) throw new Error(`Map ${map.key} did not load any tile textures.`);
      return textures;
    });

    this.tileTextureCache.set(map.sourceUrl, loading);
    return loading;
  }

  getOutfitFrames(outfitKey: string): Promise<OutfitFrames | undefined> {
    const cached = this.outfitTextureCache.get(outfitKey);
    if (cached) return cached;
    const loading = this.loadManifest()
      .then(async (manifest) => {
        const definition = manifest.outfits[outfitKey];
        if (!definition) return undefined;
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
