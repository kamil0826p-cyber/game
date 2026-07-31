import { Assets, Rectangle, Texture } from 'pixi.js';
import type { CharacterGender, Direction } from '../../contracts/game';
import { outfitImageCandidates } from '../../mock/outfitCatalog';

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

const createFrames = (baseTexture: Texture): OutfitSheetFrames => {
  baseTexture.source.scaleMode = 'nearest';
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

const loadFrames = async (
  outfitKey: string,
  gender: CharacterGender,
): Promise<OutfitSheetFrames> => {
  const errors: unknown[] = [];

  for (const url of outfitImageCandidates(outfitKey, gender)) {
    try {
      const baseTexture = await Assets.load<Texture>(url);
      if (baseTexture.source.width !== SHEET_WIDTH || baseTexture.source.height !== SHEET_HEIGHT) {
        await Assets.unload(url);
        throw new Error(
          `Outfit ${outfitKey} has invalid dimensions ${baseTexture.source.width}x${baseTexture.source.height}. Expected ${SHEET_WIDTH}x${SHEET_HEIGHT}.`,
        );
      }
      return createFrames(baseTexture);
    } catch (error) {
      errors.push(error);
      console.warn(`Outfit candidate failed for ${outfitKey} (${gender}): ${url}`, error);
    }
  }

  throw new AggregateError(errors, `No outfit image candidate could be loaded for ${outfitKey} (${gender}).`);
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
    console.error(`Failed to load outfit ${outfitKey} (${gender}).`, error);
    return undefined;
  });
  frameCache.set(cacheKey, loading);
  return loading;
};
