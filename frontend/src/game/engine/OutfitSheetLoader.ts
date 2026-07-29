import { Assets, Rectangle, Texture } from 'pixi.js';
import type { Direction } from '../../contracts/game';
import { outfitImageUrl } from '../../mock/outfitCatalog';

export interface OutfitSheetFrames {
  frameDurationMs: number;
  frames: Record<Direction, Texture[]>;
}

const FRAME_WIDTH = 32;
const FRAME_HEIGHT = 48;
const SHEET_WIDTH = 128;
const SHEET_HEIGHT = 192;
const directionRows: Record<Direction, number> = { SOUTH: 0, WEST: 1, EAST: 2, NORTH: 3 };
const frameCache = new Map<string, Promise<OutfitSheetFrames | undefined>>();

const loadFrames = async (outfitKey: string): Promise<OutfitSheetFrames> => {
  const url = outfitImageUrl(outfitKey);
  const baseTexture = await Assets.load<Texture>(url);
  baseTexture.source.scaleMode = 'nearest';

  if (baseTexture.source.width !== SHEET_WIDTH || baseTexture.source.height !== SHEET_HEIGHT) {
    Assets.unload(url);
    throw new Error(
      `Outfit ${outfitKey} has invalid dimensions ${baseTexture.source.width}x${baseTexture.source.height}. Expected ${SHEET_WIDTH}x${SHEET_HEIGHT}.`,
    );
  }

  const frames = Object.fromEntries(
    (Object.keys(directionRows) as Direction[]).map((direction) => {
      const row = directionRows[direction];
      return [
        direction,
        Array.from({ length: 4 }, (_, column) => new Texture({
          source: baseTexture.source,
          frame: new Rectangle(
            column * FRAME_WIDTH,
            row * FRAME_HEIGHT,
            FRAME_WIDTH,
            FRAME_HEIGHT,
          ),
        })),
      ];
    }),
  ) as Record<Direction, Texture[]>;

  return { frameDurationMs: 120, frames };
};

export const getOutfitSheetFrames = (outfitKey: string): Promise<OutfitSheetFrames | undefined> => {
  const cached = frameCache.get(outfitKey);
  if (cached) return cached;

  const loading = loadFrames(outfitKey).catch((error: unknown) => {
    frameCache.delete(outfitKey);
    console.error(`Failed to load outfit ${outfitKey}.`, error);
    return undefined;
  });
  frameCache.set(outfitKey, loading);
  return loading;
};
