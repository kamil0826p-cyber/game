import { Assets, Rectangle, Texture } from 'pixi.js';
import type { CharacterGender, Direction } from '../../contracts/game';
import { outfitImageUrl } from '../../mock/outfitCatalog';
import {
  OUTFIT_FRAME_HEIGHT,
  OUTFIT_FRAME_WIDTH,
  OUTFIT_SHEET_HEIGHT,
  OUTFIT_SHEET_WIDTH,
} from './outfitSpriteMetrics';

export interface OutfitSheetFrames {
  frameDurationMs: number;
  frames: Record<Direction, Texture[]>;
}

const directionRows: Record<Direction, number> = { SOUTH: 0, WEST: 1, EAST: 2, NORTH: 3 };
const frameCache = new Map<string, Promise<OutfitSheetFrames | undefined>>();

const createFrames = (baseTexture: Texture): OutfitSheetFrames => {
  baseTexture.source.scaleMode = 'nearest';
  const frames = Object.fromEntries(
    (Object.keys(directionRows) as Direction[]).map((direction) => {
      const row = directionRows[direction];
      return [
        direction,
        Array.from(
          { length: 4 },
          (_, column) =>
            new Texture({
              source: baseTexture.source,
              frame: new Rectangle(
                column * OUTFIT_FRAME_WIDTH,
                row * OUTFIT_FRAME_HEIGHT,
                OUTFIT_FRAME_WIDTH,
                OUTFIT_FRAME_HEIGHT,
              ),
            }),
        ),
      ];
    }),
  ) as Record<Direction, Texture[]>;

  return { frameDurationMs: 120, frames };
};

const loadFrames = async (
  outfitKey: string,
  gender: CharacterGender,
): Promise<OutfitSheetFrames> => {
  const sourceUrl = outfitImageUrl(outfitKey, gender);
  const baseTexture = await Assets.load<Texture>(sourceUrl);

  if (
    baseTexture.source.width !== OUTFIT_SHEET_WIDTH ||
    baseTexture.source.height !== OUTFIT_SHEET_HEIGHT
  ) {
    await Assets.unload(sourceUrl);
    throw new Error(
      `Outfit ${outfitKey} has invalid dimensions ${baseTexture.source.width}x${baseTexture.source.height}. Expected ${OUTFIT_SHEET_WIDTH}x${OUTFIT_SHEET_HEIGHT}.`,
    );
  }

  return createFrames(baseTexture);
};

export const getOutfitSheetFrames = (
  outfitKey: string,
  gender: CharacterGender = 'MALE',
): Promise<OutfitSheetFrames | undefined> => {
  const cacheKey = `${gender}:${outfitKey}`;
  const cached = frameCache.get(cacheKey);
  if (cached) return cached;

  const loading = loadFrames(outfitKey, gender).catch((error: unknown) => {
    frameCache.delete(cacheKey);
    console.error(`Failed to load outfit ${outfitKey}.`, error);
    return undefined;
  });
  frameCache.set(cacheKey, loading);
  return loading;
};
