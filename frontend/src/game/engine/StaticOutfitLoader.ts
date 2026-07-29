import { Rectangle, Texture } from 'pixi.js';
import type { Direction } from '../../contracts/game';

const ATLAS_URL = '/assets/sprites/outfits-atlas.svg?v=8';
const SHEET_WIDTH = 128;
const SHEET_HEIGHT = 192;
const FRAME_WIDTH = 32;
const FRAME_HEIGHT = 48;
const FRAME_DURATION_MS = 120;

const outfitOrder = [
  'mage-apprentice',
  'mage-scholar',
  'mage-evoker',
  'mage-archmage',
  'mage-illusionist',
  'mage-elementalist',
  'mage-runekeeper',
  'mage-starcaller',
  'mage-chronomancer',
  'mage-voidseer',
  'mage-ascendant',
  'warrior-recruit',
  'warrior-guard',
  'warrior-vanguard',
  'warrior-champion',
  'warrior-berserker',
  'warrior-templar',
  'warrior-warlord',
  'warrior-dreadnought',
  'warrior-kingsguard',
  'warrior-titan',
  'warrior-immortal',
  'archer-scout',
  'archer-hunter',
  'archer-pathfinder',
  'archer-ranger',
  'archer-sharpshooter',
  'archer-beaststalker',
  'archer-windrunner',
  'archer-nightstalker',
  'archer-warden',
  'archer-legend',
  'archer-starshot',
] as const;

const outfitIndex = new Map<string, number>(outfitOrder.map((key, index) => [key, index]));
const directionRows: Record<Direction, number> = { SOUTH: 0, WEST: 1, EAST: 2, NORTH: 3 };

export interface StaticOutfitFrames {
  frameDurationMs: number;
  frames: Record<Direction, Texture[]>;
}

const loadImage = (url: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error(`Outfit sprite ${url} could not be decoded.`));
  image.src = url;
});

class StaticOutfitLoader {
  private atlasTextPromise?: Promise<string>;
  private readonly sheetCache = new Map<string, Promise<HTMLCanvasElement | undefined>>();
  private readonly frameCache = new Map<string, Promise<StaticOutfitFrames | undefined>>();

  getSheet(outfitKey: string): Promise<HTMLCanvasElement | undefined> {
    const cached = this.sheetCache.get(outfitKey);
    if (cached) return cached;

    const loading = this.loadSheet(outfitKey).catch(() => undefined);
    this.sheetCache.set(outfitKey, loading);
    return loading;
  }

  getFrames(outfitKey: string): Promise<StaticOutfitFrames | undefined> {
    const cached = this.frameCache.get(outfitKey);
    if (cached) return cached;

    const loading = this.getSheet(outfitKey).then((sheet) => {
      if (!sheet) return undefined;
      const baseTexture = Texture.from(sheet);
      baseTexture.source.scaleMode = 'nearest';
      const frames = Object.fromEntries((Object.keys(directionRows) as Direction[]).map((direction) => {
        const row = directionRows[direction];
        return [direction, Array.from({ length: 4 }, (_, column) => new Texture({
          source: baseTexture.source,
          frame: new Rectangle(column * FRAME_WIDTH, row * FRAME_HEIGHT, FRAME_WIDTH, FRAME_HEIGHT),
        }))];
      })) as Record<Direction, Texture[]>;
      return { frameDurationMs: FRAME_DURATION_MS, frames };
    });

    this.frameCache.set(outfitKey, loading);
    return loading;
  }

  private loadAtlasText(): Promise<string> {
    if (!this.atlasTextPromise) {
      this.atlasTextPromise = fetch(ATLAS_URL, { cache: 'force-cache' }).then(async (response) => {
        if (!response.ok) throw new Error(`Outfit atlas failed to load (${response.status}).`);
        return response.text();
      });
    }
    return this.atlasTextPromise;
  }

  private async loadSheet(outfitKey: string): Promise<HTMLCanvasElement | undefined> {
    const index = outfitIndex.get(outfitKey);
    if (index === undefined) return undefined;

    const document = new DOMParser().parseFromString(await this.loadAtlasText(), 'image/svg+xml');
    const root = document.documentElement;
    if (root.nodeName.toLowerCase() !== 'svg' || document.querySelector('parsererror')) {
      throw new Error('The static outfit atlas is malformed.');
    }

    root.setAttribute('viewBox', `0 ${index * SHEET_HEIGHT} ${SHEET_WIDTH} ${SHEET_HEIGHT}`);
    root.setAttribute('width', String(SHEET_WIDTH));
    root.setAttribute('height', String(SHEET_HEIGHT));

    const blobUrl = URL.createObjectURL(new Blob(
      [new XMLSerializer().serializeToString(root)],
      { type: 'image/svg+xml' },
    ));

    try {
      const image = await loadImage(blobUrl);
      const canvas = window.document.createElement('canvas');
      canvas.width = SHEET_WIDTH;
      canvas.height = SHEET_HEIGHT;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('A 2D canvas context is required for outfit sprites.');
      context.imageSmoothingEnabled = false;
      context.drawImage(image, 0, 0, SHEET_WIDTH, SHEET_HEIGHT);
      return canvas;
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }
}

export const staticOutfitLoader = new StaticOutfitLoader();
