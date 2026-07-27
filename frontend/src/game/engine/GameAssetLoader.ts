import { Assets, Rectangle, Texture } from 'pixi.js';
import type { CharacterClass, Direction } from '../../contracts/game';

const ASSET_CACHE_VERSION = 'forest-path-v2';
const versionedUrl = (url: string): string =>
  `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(ASSET_CACHE_VERSION)}`;

export interface TileSetAssetDefinition {
  image: string;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  gidToFrame: Record<string, number>;
}

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
  tilesets: Record<string, TileSetAssetDefinition>;
  outfits: Record<string, OutfitAssetDefinition>;
}

export interface OutfitFrames {
  definition: OutfitAssetDefinition;
  frames: Record<Direction, Texture[]>;
}

class GameAssetLoader {
  private manifestPromise?: Promise<AssetManifest>;
  private readonly tileTextureCache = new Map<string, Promise<Map<number, Texture> | undefined>>();
  private readonly outfitTextureCache = new Map<string, Promise<OutfitFrames | undefined>>();

  loadManifest(): Promise<AssetManifest> {
    if (!this.manifestPromise) {
      this.manifestPromise = fetch(versionedUrl('/assets/manifest.json'), { cache: 'no-store' }).then(
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

  getTileTextures(mapKey: string): Promise<Map<number, Texture> | undefined> {
    const cached = this.tileTextureCache.get(mapKey);
    if (cached) {
      return cached;
    }
    const loading = this.loadManifest()
      .then(async (manifest) => {
        const definition = manifest.tilesets[mapKey];
        if (!definition) {
          return undefined;
        }
        const baseTexture = await Assets.load<Texture>(versionedUrl(definition.image));
        baseTexture.source.scaleMode = 'nearest';
        const textures = new Map<number, Texture>();
        for (const [gidText, frameIndex] of Object.entries(definition.gidToFrame)) {
          const column = frameIndex % definition.columns;
          const row = Math.floor(frameIndex / definition.columns);
          textures.set(
            Number(gidText),
            new Texture({
              source: baseTexture.source,
              frame: new Rectangle(
                column * definition.tileWidth,
                row * definition.tileHeight,
                definition.tileWidth,
                definition.tileHeight,
              ),
            }),
          );
        }
        return textures;
      })
      .catch(() => undefined);
    this.tileTextureCache.set(mapKey, loading);
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
        const baseTexture = await Assets.load<Texture>(versionedUrl(definition.image));
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