import { Assets, Rectangle, Texture } from 'pixi.js';
import type { CharacterClass, Direction } from '../../contracts/game';
import type { CompiledTileRenderDefinition, LoadedMapDefinition, TiledTilesetReference } from '../../contracts/tiled';
import { MAX_RENDER_RESOLUTION, WORLD_TILE_SIZE } from './constants';

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

interface LoadedTextureSource {
  texture: Texture;
  coordinateScale: number;
}

interface SvgViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MAX_SVG_RASTER_SCALE = 12;
const MAX_SVG_RASTER_PIXELS = 16_777_216;

const resolveAssetUrl = (path: string, baseUrl: string): string => new URL(path, new URL(baseUrl, window.location.origin)).toString();
const isSvgUrl = (url: string): boolean => new URL(url, window.location.origin).pathname.toLowerCase().endsWith('.svg');

export const calculateSvgRasterScale = (
  imageWidth: number,
  imageHeight: number,
  tileWidth: number,
  tileHeight: number,
  maxRenderWidthTiles: number,
  maxRenderHeightTiles: number,
  resolution: number,
): number => {
  const displayScale = Math.max(
    WORLD_TILE_SIZE / tileWidth,
    WORLD_TILE_SIZE / tileHeight,
    (WORLD_TILE_SIZE * maxRenderWidthTiles) / tileWidth,
    (WORLD_TILE_SIZE * maxRenderHeightTiles) / tileHeight,
  );
  const desiredScale = Math.max(1, Math.ceil(displayScale * Math.max(1, resolution)));
  const pixelBudgetScale = Math.max(1, Math.floor(Math.sqrt(MAX_SVG_RASTER_PIXELS / Math.max(1, imageWidth * imageHeight))));
  return Math.min(desiredScale, MAX_SVG_RASTER_SCALE, pixelBudgetScale);
};

const loadImage = (url: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error(`Image ${url} could not be decoded.`));
  image.src = url;
});

const parseViewBox = (value: string | null, fallback: SvgViewBox): SvgViewBox => {
  if (!value) return fallback;
  const parts = value.trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return fallback;
  const [x = fallback.x, y = fallback.y, width = fallback.width, height = fallback.height] = parts;
  if (width <= 0 || height <= 0) return fallback;
  return { x, y, width, height };
};

const textureFromSvgElement = async (element: Element, viewBox: SvgViewBox, scale: number): Promise<Texture> => {
  const pixelWidth = Math.max(1, Math.ceil(viewBox.width * scale));
  const pixelHeight = Math.max(1, Math.ceil(viewBox.height * scale));
  const svg = window.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
  svg.setAttribute('width', String(pixelWidth));
  svg.setAttribute('height', String(pixelHeight));
  svg.appendChild(window.document.importNode(element, true));

  const objectUrl = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  try {
    const image = await loadImage(objectUrl);
    const canvas = window.document.createElement('canvas');
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('A 2D canvas context is required to rasterize SVG tilesets.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, pixelWidth, pixelHeight);
    const texture = Texture.from(canvas);
    texture.source.scaleMode = 'linear';
    return texture;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const rasterizeSvg = async (url: string, logicalWidth: number, logicalHeight: number, scale: number): Promise<Texture> => {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`SVG ${url} could not be loaded (${response.status}).`);
  const svgDocument = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
  const root = svgDocument.documentElement;
  if (root.nodeName.toLowerCase() !== 'svg' || svgDocument.querySelector('parsererror')) throw new Error(`SVG ${url} is malformed.`);
  return textureFromSvgElement(root, parseViewBox(root.getAttribute('viewBox'), { x: 0, y: 0, width: logicalWidth, height: logicalHeight }), scale);
};

const loadSvgAtlasTiles = async (
  url: string,
  firstGid: number,
  tileWidth: number,
  tileHeight: number,
  columns: number,
  tileCount: number,
  margin: number,
  spacing: number,
  scale: number,
): Promise<Map<number, Texture> | undefined> => {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`SVG ${url} could not be loaded (${response.status}).`);
  const svgDocument = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
  const root = svgDocument.documentElement;
  if (root.nodeName.toLowerCase() !== 'svg' || svgDocument.querySelector('parsererror')) throw new Error(`SVG ${url} is malformed.`);
  const groups = Array.from(root.querySelectorAll('[data-tile-id]'));
  if (groups.length === 0) return undefined;

  const textures = new Map<number, Texture>();
  await Promise.all(groups.map(async (group) => {
    const localId = Number(group.getAttribute('data-tile-id'));
    if (!Number.isInteger(localId) || localId < 0 || localId >= tileCount) return;
    const column = localId % columns;
    const row = Math.floor(localId / columns);
    const fallback = {
      x: margin + column * (tileWidth + spacing),
      y: margin + row * (tileHeight + spacing),
      width: tileWidth,
      height: tileHeight,
    };
    const viewBox = parseViewBox(group.getAttribute('data-viewbox'), fallback);
    textures.set(firstGid + localId, await textureFromSvgElement(group, viewBox, scale));
  }));
  return textures;
};

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

  private maxRenderSize(map: LoadedMapDefinition, firstGid: number, tileCount: number): Pick<CompiledTileRenderDefinition, 'widthTiles' | 'heightTiles'> {
    let widthTiles = 1;
    let heightTiles = 1;
    for (let localId = 0; localId < tileCount; localId += 1) {
      const definition = map.tileRenderDefinitions.get(firstGid + localId);
      if (!definition) continue;
      widthTiles = Math.max(widthTiles, definition.widthTiles);
      heightTiles = Math.max(heightTiles, definition.heightTiles);
    }
    return { widthTiles, heightTiles };
  }

  private async loadTextureSource(
    url: string,
    logicalWidth: number | undefined,
    logicalHeight: number | undefined,
    rasterScale: number,
  ): Promise<LoadedTextureSource> {
    if (isSvgUrl(url) && logicalWidth && logicalHeight) {
      return { texture: await rasterizeSvg(url, logicalWidth, logicalHeight, rasterScale), coordinateScale: rasterScale };
    }
    const texture = await Assets.load<Texture>(url);
    texture.source.scaleMode = isSvgUrl(url) ? 'linear' : 'nearest';
    return { texture, coordinateScale: 1 };
  }

  private async loadTilesetTextures(map: LoadedMapDefinition, tileset: TiledTilesetReference, textures: Map<number, Texture>): Promise<void> {
    const baseUrl = tileset.resolvedSourceUrl ?? map.sourceUrl;
    const tileWidth = tileset.tilewidth ?? map.tileWidth;
    const tileHeight = tileset.tileheight ?? map.tileHeight;
    const margin = tileset.margin ?? 0;
    const spacing = tileset.spacing ?? 0;

    if (tileset.image) {
      const imageUrl = resolveAssetUrl(tileset.image, baseUrl);
      const fallbackColumns = tileset.columns ?? 1;
      const tileCount = tileset.tilecount ?? fallbackColumns;
      const maxRenderSize = this.maxRenderSize(map, tileset.firstgid, tileCount);
      const rasterScale = tileset.imagewidth && tileset.imageheight ? calculateSvgRasterScale(
        tileset.imagewidth,
        tileset.imageheight,
        tileWidth,
        tileHeight,
        maxRenderSize.widthTiles,
        maxRenderSize.heightTiles,
        Math.min(window.devicePixelRatio || 1, MAX_RENDER_RESOLUTION),
      ) : 1;
      const columns = tileset.columns ?? Math.max(1, Math.floor(((tileset.imagewidth ?? tileWidth) - margin * 2 + spacing) / (tileWidth + spacing)));

      if (isSvgUrl(imageUrl)) {
        const svgTiles = await loadSvgAtlasTiles(imageUrl, tileset.firstgid, tileWidth, tileHeight, columns, tileCount, margin, spacing, rasterScale);
        if (svgTiles) for (const [gid, texture] of svgTiles) textures.set(gid, texture);
        if (svgTiles?.size === tileCount) return;
      }

      const loaded = await this.loadTextureSource(imageUrl, tileset.imagewidth, tileset.imageheight, rasterScale);
      const imageWidth = tileset.imagewidth ?? loaded.texture.source.width;
      const imageHeight = tileset.imageheight ?? loaded.texture.source.height;
      const resolvedColumns = tileset.columns ?? Math.max(1, Math.floor((imageWidth - margin * 2 + spacing) / (tileWidth + spacing)));
      const rows = Math.max(1, Math.floor((imageHeight - margin * 2 + spacing) / (tileHeight + spacing)));
      const resolvedTileCount = tileset.tilecount ?? resolvedColumns * rows;
      for (let localId = 0; localId < resolvedTileCount; localId += 1) {
        const gid = tileset.firstgid + localId;
        if (textures.has(gid)) continue;
        const column = localId % resolvedColumns;
        const row = Math.floor(localId / resolvedColumns);
        if (row >= rows) break;
        textures.set(gid, new Texture({
          source: loaded.texture.source,
          frame: new Rectangle(
            (margin + column * (tileWidth + spacing)) * loaded.coordinateScale,
            (margin + row * (tileHeight + spacing)) * loaded.coordinateScale,
            tileWidth * loaded.coordinateScale,
            tileHeight * loaded.coordinateScale,
          ),
        }));
      }
    }

    for (const tile of tileset.tiles ?? []) {
      if (!tile.image) continue;
      const gid = tileset.firstgid + tile.id;
      const definition = map.tileRenderDefinitions.get(gid);
      const imageWidth = tile.imagewidth ?? tileWidth;
      const imageHeight = tile.imageheight ?? tileHeight;
      const rasterScale = calculateSvgRasterScale(
        imageWidth,
        imageHeight,
        imageWidth,
        imageHeight,
        definition?.widthTiles ?? imageWidth / map.tileWidth,
        definition?.heightTiles ?? imageHeight / map.tileHeight,
        Math.min(window.devicePixelRatio || 1, MAX_RENDER_RESOLUTION),
      );
      const loaded = await this.loadTextureSource(resolveAssetUrl(tile.image, baseUrl), imageWidth, imageHeight, rasterScale);
      textures.set(gid, loaded.texture);
    }
  }

  private async loadManifestTileTextures(mapKey: string): Promise<Map<number, Texture> | undefined> {
    try {
      const manifest = await this.loadManifest();
      const definition = manifest.tilesets[mapKey];
      if (!definition) return undefined;
      const baseTexture = await Assets.load<Texture>(definition.image);
      baseTexture.source.scaleMode = isSvgUrl(definition.image) ? 'linear' : 'nearest';
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
