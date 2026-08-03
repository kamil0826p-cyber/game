import { access, readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileCollisionGrid, extractEmbeddedPortals, parseTiledMap } from '../src/modules/maps/tiled-map.parser.js';

const mapNames = ['greenfields', 'crystal-cave'] as const;
const tileDescriptorNames = [
  'dark-forest-terrain.tsj',
  'black-pine-trunk.tsj',
  'black-pine-canopy.tsj',
  'cave.tsj',
] as const;
const expectedTileSources = tileDescriptorNames.map((fileName) => `../assets/tiles/${fileName}`);
const frontendTileRoot = resolve('frontend', 'public', 'assets', 'tiles');
const backendTileRoot = resolve('prisma', 'assets', 'tiles');
const legacyTileRoots = [
  resolve('frontend', 'public', 'maps', 'tiles'),
  resolve('prisma', 'maps', 'tiles'),
] as const;

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8')) as unknown;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const externalTilesetSources = (value: unknown): string[] => {
  if (!isRecord(value) || !Array.isArray(value.tilesets)) throw new Error('Map tilesets are malformed.');
  return value.tilesets.map((tileset) => {
    if (!isRecord(tileset) || typeof tileset.source !== 'string')
      throw new Error('Every committed map tileset must use an external TSJ source.');
    return tileset.source;
  });
};

const tilesetImageSources = (value: unknown): string[] => {
  if (!isRecord(value)) throw new Error('Tileset is malformed.');
  const images: string[] = [];
  if (typeof value.image === 'string') images.push(value.image);
  if (Array.isArray(value.tiles)) {
    for (const tile of value.tiles)
      if (isRecord(tile) && typeof tile.image === 'string') images.push(tile.image);
  }
  return images;
};

describe('committed Tiled map assets', () => {
  for (const mapName of mapNames) {
    it(`${mapName} is valid and synchronized with the browser copy`, async () => {
      const backendPath = resolve('prisma', 'maps', `${mapName}.json`);
      const frontendPath = resolve('frontend', 'public', 'maps', `${mapName}.json`);
      const [backendSource, frontendSource] = await Promise.all([readJson(backendPath), readJson(frontendPath)]);

      expect(frontendSource).toEqual(backendSource);
      expect(externalTilesetSources(frontendSource)).toEqual(expectedTileSources);
      for (const source of expectedTileSources) {
        expect(extname(source)).toBe('.tsj');
        await expect(access(resolve(dirname(frontendPath), source))).resolves.toBeUndefined();
        await expect(access(resolve(dirname(backendPath), source))).resolves.toBeUndefined();
      }

      const map = parseTiledMap(backendSource);
      expect(map.width).toBeGreaterThan(0);
      expect(map.height).toBeGreaterThan(0);
      const tileLayers = map.layers.filter((layer) => layer.type === 'tilelayer');
      expect(tileLayers.length).toBeGreaterThan(0);
      for (const layer of tileLayers) {
        expect(layer.width).toBe(map.width);
        expect(layer.height).toBe(map.height);
        expect(layer.data).toHaveLength(map.width * map.height);
      }
      expect(compileCollisionGrid(map)).toHaveLength(map.width * map.height);
      const portals = extractEmbeddedPortals(map);
      expect(portals.length).toBeGreaterThan(0);
      for (const portal of portals) {
        expect(portal.sourceX).toBeGreaterThanOrEqual(0);
        expect(portal.sourceX).toBeLessThan(map.width);
        expect(portal.sourceY).toBeGreaterThanOrEqual(0);
        expect(portal.sourceY).toBeLessThan(map.height);
      }
    });
  }

  it('keeps every frontend tile descriptor and image in one canonical directory', async () => {
    for (const fileName of tileDescriptorNames) {
      const [frontendTileset, backendTileset] = await Promise.all([
        readJson(resolve(frontendTileRoot, fileName)),
        readJson(resolve(backendTileRoot, fileName)),
      ]);
      const expectedName = fileName.slice(0, -extname(fileName).length);
      expect(frontendTileset).toMatchObject({ type: 'tileset', name: expectedName });
      expect(backendTileset).toMatchObject({ type: 'tileset', name: expectedName });

      const imageSources = tilesetImageSources(frontendTileset);
      expect(imageSources.length).toBeGreaterThan(0);
      for (const imageSource of imageSources) {
        expect(extname(imageSource)).toBe('.svg');
        expect(imageSource).not.toContain('/');
        expect(imageSource).not.toContain('\\');
        await expect(access(resolve(frontendTileRoot, imageSource))).resolves.toBeUndefined();
      }
    }

    for (const legacyRoot of legacyTileRoots)
      await expect(access(legacyRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
