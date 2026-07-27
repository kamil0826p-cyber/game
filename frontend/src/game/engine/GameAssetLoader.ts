import { Assets, Rectangle, Texture } from 'pixi.js';
import type { CharacterClass, Direction } from '../../contracts/game';
import type { LoadedMapDefinition, TiledTilesetReference } from '../../contracts/tiled';

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

const resolveAssetUrl = (path: string, baseUrl: string): string => new URL(path, new URL(baseUrl, window.location.origin)).toString();

class GameAssetLoader {
  private manifestPromise?: Promise<AssetManifest>;
  private readonly tiledTextureCache = new Map<string, Promise<Map<number, Texture> | undefined>>();
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

  getTileTextures(map: LoadedMapDefinition): Promise<Map<number, Texture> | undefined> {
    const cacheKey = `${map.key}:${map.sourceUrl}`;
    const cached = this.tiledTextureCache.get(cacheKey);
    if (cached) return cached;
    const loading = this.loadTiledTextures(map).then(async (textures) => textures.size > 0 ? textures : this.loadManifestTileTextures(map.key));
    this.tiledTextureCache.set(cacheKey, loading);
    return loading;
  }

  private async loadTiledTextures(map: LoadedMapDefinition): Promise<Map<number, Texture>> {
    const textures = new Map<number, Texture>();
    for (const tileset of map.source.tilesets) await this.loadTilesetTextures(map, tileset, textures);
    return textures;
  }

  private async loadTilesetTextures(map: LoadedMapDefinition, tileset: TiledTilesetReference, textures: Map<number, Texture>): Promise<void> {
    const baseUrl = tileset.resolvedSourceUrl ?? map.sourceUrl;
    const tileWidth = tileset.tilewidth ?? map.tileWidth;
    const tileHeight = tileset.tileheight ?? map.tileHeight;
    const margin = tileset.margin ?? 0;
    const spacing = tileset.spacing ?? 0;

    if (tileset.image) {
      const baseTexture = await Assets.load<Texture>(resolveAssetUrl(tileset.image, baseUrl));
      baseTexture.source.scaleMode = 'nearest';
      const imageWidth = tileset.imagewidth ?? baseTexture.source.width;
      const imageHeight = tileset.imageheight ?? baseTexture.source.height;
      const columns = tileset.columns ?? Math.max(1, Math.floor((imageWidth - margin * 2 + spacing) / (tileWidth + spacing)));
      const rows = Math.max(1, Math.floor((imageHeight - margin * 2 + spacing) / (tileHeight + spacing)));
      const tileCount = tileset.tilecount ?? columns * rows;
      for (let localId = 0; localId < tileCount; localId += 1) {
        const column = localId % columns;
        const row = Math.floor(localId / columns);
        if (row >= rows) break;
        textures.set(tileset.firstgid + localId, new Texture({
          source: baseTexture.source,
          frame: new Rectangle(margin + column * (tileWidth + spacing), margin + row * (tileHeight + spacing), tileWidth, tileHeight),
        }));
      }
    }

    for (const tile of tileset.tiles ?? []) {
      if (!tile.image) continue;
      const texture = await Assets.load<Texture>(resolveAssetUrl(tile.image, baseUrl));
      texture.source.scaleMode = 'nearest';
      textures.set(tileset.firstgid + tile.id, texture);
    }
  }

  private async loadManifestTileTextures(mapKey: string): Promise<Map<number, Texture> | undefined> {
    try {
      const manifest = await this.loadManifest();
      const definition = manifest.tilesets[mapKey];
      if (!definition) return undefined;
      const baseTexture = await Assets.load<Texture>(definition.image);
      baseTexture.source.scaleMode = 'nearest';
      const textures = new Map<number, Texture>();
      for (const [gidText, frameIndex] of Object.entries(definition.gidToFrame)) {
        const column = frameIndex % definition.columns;
        const row = Math.floor(frameIndex / definition.columns);
        textures.set(Number(gidText), new Texture({ source: baseTexture.source, frame: new Rectangle(column * definition.tileWidth, row * definition.tileHeight, definition.tileWidth, definition.tileHeight) }));
      }
      return textures;
    } catch {
      return undefined;
    }
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
        return [direction, Array.from({ length: definition.framesPerDirection }, (_, column) => new Texture({ source: baseTexture.source, frame: new Rectangle(column * definition.frameWidth, row * definition.frameHeight, definition.frameWidth, definition.frameHeight) }))];
      })) as unknown as Record<Direction, Texture[]>;
      return { definition, frames };
    }).catch(() => undefined);
    this.outfitTextureCache.set(outfitKey, loading);
    return loading;
  }
}

export const gameAssetLoader = new GameAssetLoader();
