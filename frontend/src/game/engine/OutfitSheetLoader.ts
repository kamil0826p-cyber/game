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

export const extractEmbeddedPng = (svgText: string): Uint8Array | undefined => {
  const match = svgText.match(/(?:href|xlink:href)=["']data:image\/png;base64,([^"']+)["']/i);
  if (!match?.[1]) return undefined;

  const binary = atob(match[1].replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const drawSheet = (image: CanvasImageSource): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = SHEET_WIDTH;
  canvas.height = SHEET_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context is required for outfit rendering.');
  context.imageSmoothingEnabled = false;
  context.drawImage(image, 0, 0, SHEET_WIDTH, SHEET_HEIGHT);
  return canvas;
};

const createSheetCanvas = async (outfitKey: string): Promise<HTMLCanvasElement> => {
  const url = outfitImageUrl(outfitKey);
  if (new URL(url, window.location.origin).pathname.toLowerCase().endsWith('.svg')) {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Outfit ${url} could not be loaded (${response.status}).`);
    const embeddedPng = extractEmbeddedPng(await response.text());
    if (!embeddedPng) throw new Error(`Outfit ${url} does not contain an embedded PNG sheet.`);

    const objectUrl = URL.createObjectURL(new Blob([embeddedPng], { type: 'image/png' }));
    try {
      return drawSheet(await loadImage(objectUrl));
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  return drawSheet(await loadImage(url));
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
