import { Assets, Rectangle, Texture } from 'pixi.js';
import type { CharacterClass, Direction } from '../../contracts/game';
import type { TiledMapJson, TiledTilesetReference } from '../../contracts/tiled';

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

const resolveMapAsset = (value: string): string => {
  if (/^(https?:|data:|\/)/.test(value)) return value;
  return `/maps/${value.replace(/^\.\//, '')}`;
};

class GameAssetLoader {
  private manifestPromise?: Promise<AssetManifest>;
  private readonly tileTextureCache = new Map<string, Promise<Map<number, Texture>>>();
  private readonly outfitTextureCache = new Map<string, Promise<OutfitFrames | undefined>>();

  loadManifest(): Promise<AssetManifest> {
    if (!this.manifestPromise) {
      this.manifestPromise = fetch('/assets/manifest.json', { cache: 'force-cache' }).then(async (response) => {
        if (!response.ok) throw new Error(`Asset manifest failed to load (${response.status}).`);
        return response.json() as Promise<AssetManifest>;
      });
    }
    return this.manifestPromise;
  }

  getMapTileTextures(map: TiledMapJson, mapKey: string): Promise<Map<number, Texture>> {
    const cacheKey = `${mapKey}:${JSON.stringify(map.tilesets.map(({ firstgid, image, source }) => [firstgid, image, source]))}`;
    const cached = this.tileTextureCache.get(cacheKey);
    if (cached) return cached;
    const loading = this.loadTiledTilesets(map.tilesets).then(async (textures) => {
      if (textures.size > 0) return textures;
      const manifest = await this.loadManifest();
      const legacy = manifest.tilesets[mapKey];
      if (!legacy) return textures;
      const baseTexture = await Assets.load<Texture>(legacy.image);
      baseTexture.source.scaleMode = 'nearest';
      for (const [gidText, frameIndex] of Object.entries(legacy.gidToFrame)) {
        const column = frameIndex % legacy.columns;
        const row = Math.floor(frameIndex / legacy.columns);
        textures.set(Number(gidText), new Texture({
          source: baseTexture.source,
          frame: new Rectangle(column * legacy.tileWidth, row * legacy.tileHeight, legacy.tileWidth, legacy.tileHeight),
        }));
      }
      return textures;
    }).catch(() => new Map<number, Texture>());
    this.tileTextureCache.set(cacheKey, loading);
    return loading;
  }

  private async loadTiledTilesets(tilesets: readonly TiledTilesetReference[]): Promise<Map<number, Texture>> {
    const result = new Map<number, Texture>();
    await Promise.all(tilesets.map(async (tileset) => {
      if (!tileset.image || !tileset.columns || !tileset.tilecount || !tileset.tilewidth || !tileset.tileheight) return;
      const baseTexture = await Assets.load<Texture>(resolveMapAsset(tileset.image));
      baseTexture.source.scaleMode = 'nearest';
      const spacing = tileset.spacing ?? 0;
      const margin = tileset.margin ?? 0;
      for (let localId = 0; localId < tileset.tilecount; localId += 1) {
        const column = localId % tileset.columns;
        const row = Math.floor(localId / tileset.columns);
        result.set(tileset.firstgid + localId, new Texture({
          source: baseTexture.source,
          frame: new Rectangle(
            margin + column * (tileset.tilewidth + spacing),
            margin + row * (tileset.tileheight + spacing),
            tileset.tilewidth,
            tileset.tileheight,
          ),
        }));
      }
    }));
    return result;
  }

  getOutfitFrames(outfitKey: string): Promise<OutfitFrames | undefined> {
    const cached = this.outfitTextureCache.get(outfitKey);
    if (cached) return cached;
    const loading = this.loadManifest().then(async (manifest) => {
      const definition = manifest.outfits[outfitKey];
      if (!definition) return undefined;
      const baseTexture = await Assets.load<Texture>(definition.image);
      baseTexture.source.scaleMode = 'nearest';
      const directions = Object.keys(definition.directionRows) as Direction[];
      const frames = Object.fromEntries(directions.map((direction) => {
        const row = definition.directionRows[direction];
        return [direction, Array.from({ length: definition.framesPerDirection }, (_, column) => new Texture({
          source: baseTexture.source,
          frame: new Rectangle(column * definition.frameWidth, row * definition.frameHeight, definition.frameWidth, definition.frameHeight),
        }))];
      })) as unknown as Record<Direction, Texture[]>;
      return { definition, frames };
    }).catch(() => undefined);
    this.outfitTextureCache.set(outfitKey, loading);
    return loading;
  }
}

export const gameAssetLoader = new GameAssetLoader();
