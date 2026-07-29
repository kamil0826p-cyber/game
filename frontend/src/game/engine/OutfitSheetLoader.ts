import { Rectangle, Texture } from 'pixi.js';
import type { Direction } from '../../contracts/game';
import { outfitImageUrl } from '../../mock/outfitCatalog';

export interface OutfitSheetFrames {
  frameDurationMs: number;
  frames: Record<Direction, Texture[]>;
}

const directionRows: Record<Direction, number> = { SOUTH: 0, WEST: 1, EAST: 2, NORTH: 3 };
const cache = new Map<string, Promise<OutfitSheetFrames | undefined>>();

const loadImage = (url: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error(`Outfit ${url} could not be loaded.`));
  image.src = url;
});

const load = async (outfitKey: string): Promise<OutfitSheetFrames> => {
  const image = await loadImage(outfitImageUrl(outfitKey));
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 192;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context is required for outfit rendering.');
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, 128, 192);

  const baseTexture = Texture.from(canvas);
  baseTexture.source.scaleMode = 'nearest';
  const frames = Object.fromEntries((Object.keys(directionRows) as Direction[]).map((direction) => {
    const row = directionRows[direction];
    return [direction, Array.from({ length: 4 }, (_, column) => new Texture({
      source: baseTexture.source,
      frame: new Rectangle(column * 32, row * 48, 32, 48),
    }))];
  })) as Record<Direction, Texture[]>;

  return { frameDurationMs: 120, frames };
};

export const getOutfitSheetFrames = (outfitKey: string): Promise<OutfitSheetFrames | undefined> => {
  const cached = cache.get(outfitKey);
  if (cached) return cached;
  const promise = load(outfitKey).catch(() => undefined);
  cache.set(outfitKey, promise);
  return promise;
};
