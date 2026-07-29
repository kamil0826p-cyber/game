import { Rectangle, Texture } from 'pixi.js';
import type { Direction } from '../../contracts/game';
import { outfitImageUrl } from '../../mock/outfitCatalog';

export interface OutfitSheetFrames {
  frameDurationMs: number;
  frames: Record<Direction, Texture[]>;
}

const SHEET_WIDTH = 128;
const SHEET_HEIGHT = 192;
const FRAME_WIDTH = 32;
const FRAME_HEIGHT = 48;
const directionRows: Record<Direction, number> = { SOUTH: 0, WEST: 1, EAST: 2, NORTH: 3 };
const sheetCache = new Map<string, Promise<HTMLCanvasElement | undefined>>();
const frameCache = new Map<string, Promise<OutfitSheetFrames | undefined>>();

const loadImage = (url: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error(`Outfit image ${url} could not be decoded.`));
  image.src = url;
});

const createSheetCanvas = async (outfitKey: string): Promise<HTMLCanvasElement> => {
  const image = await loadImage(outfitImageUrl(outfitKey));
  if (image.naturalWidth !== SHEET_WIDTH || image.naturalHeight !== SHEET_HEIGHT) {
    throw new Error(`Outfit ${outfitKey} must be ${SHEET_WIDTH}x${SHEET_HEIGHT}px.`);
  }

  const canvas = document.createElement('canvas');
  canvas.width = SHEET_WIDTH;
  canvas.height = SHEET_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context is required for outfit rendering.');
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0);
  return canvas;
};

export const getOutfitSheetCanvas = (outfitKey: string): Promise<HTMLCanvasElement | undefined> => {
  const cached = sheetCache.get(outfitKey);
  if (cached) return cached;
  const promise = createSheetCanvas(outfitKey).catch(() => undefined);
  sheetCache.set(outfitKey, promise);
  return promise;
};

export const getOutfitSheetFrames = (outfitKey: string): Promise<OutfitSheetFrames | undefined> => {
  const cached = frameCache.get(outfitKey);
  if (cached) return cached;

  const promise = getOutfitSheetCanvas(outfitKey).then((canvas) => {
    if (!canvas) return undefined;
    const baseTexture = Texture.from(canvas);
    baseTexture.source.scaleMode = 'nearest';
    const frames = Object.fromEntries((Object.keys(directionRows) as Direction[]).map((direction) => {
      const row = directionRows[direction];
      return [direction, Array.from({ length: 4 }, (_, column) => new Texture({
        source: baseTexture.source,
        frame: new Rectangle(column * FRAME_WIDTH, row * FRAME_HEIGHT, FRAME_WIDTH, FRAME_HEIGHT),
      }))];
    })) as Record<Direction, Texture[]>;

    return { frameDurationMs: 120, frames };
  });

  frameCache.set(outfitKey, promise);
  return promise;
};
