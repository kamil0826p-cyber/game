import { access, readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const descriptors = {
  'hospital-floor.tsj': 5,
  'hospital-structure.tsj': 6,
  'hospital-beds.tsj': 6,
  'hospital-props.tsj': 18,
} as const;

const frontendRoot = resolve('frontend', 'public', 'assets', 'tiles');
const backendRoot = resolve('prisma', 'assets', 'tiles');

interface TiledProperty {
  name: string;
  type: string;
  value: unknown;
}

interface TiledTile {
  id: number;
  image: string;
  imageheight: number;
  imagewidth: number;
  properties?: TiledProperty[];
  objectgroup?: unknown;
}

interface TiledTileset {
  columns: number;
  name: string;
  tilecount: number;
  tileheight: number;
  tilewidth: number;
  tiles: TiledTile[];
  type: string;
}

const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, 'utf8')) as T;

const propertyValue = (tile: TiledTile, name: string): unknown =>
  tile.properties?.find((property) => property.name === name)?.value;

describe('reference-faithful hospital Tiled assets', () => {
  it('keeps image-collection descriptors synchronized and every graphic separate', async () => {
    const referencedImages = new Set<string>();

    for (const [fileName, expectedCount] of Object.entries(descriptors)) {
      const frontendPath = resolve(frontendRoot, fileName);
      const backendPath = resolve(backendRoot, fileName);
      const [frontend, backend] = await Promise.all([
        readJson<TiledTileset>(frontendPath),
        readJson<TiledTileset>(backendPath),
      ]);

      expect(frontend).toEqual(backend);
      expect(frontend).toMatchObject({
        columns: 0,
        name: fileName.replace(/\.tsj$/, ''),
        tilecount: expectedCount,
        tileheight: 32,
        tilewidth: 32,
        type: 'tileset',
      });
      expect(frontend.tiles).toHaveLength(expectedCount);

      for (const tile of frontend.tiles) {
        expect(extname(tile.image)).toBe('.svg');
        expect(tile.image).not.toContain('/');
        expect(tile.image).not.toContain('\\');
        expect(referencedImages.has(tile.image)).toBe(false);
        referencedImages.add(tile.image);
        expect([32, 64, 96]).toContain(tile.imagewidth);
        expect([32, 64]).toContain(tile.imageheight);
        expect(propertyValue(tile, 'assetRole')).toEqual(expect.any(String));
        await expect(access(resolve(frontendRoot, tile.image))).resolves.toBeUndefined();

        const svg = await readFile(resolve(frontendRoot, tile.image), 'utf8');
        expect(svg).toContain(`width="${tile.imagewidth}"`);
        expect(svg).toContain(`height="${tile.imageheight}"`);
        expect(svg).toContain('image-rendering="pixelated"');
      }
    }

    expect(referencedImages.size).toBe(35);
  });

  it('models each bed as three horizontal 32x64 segments with full footprints', async () => {
    const beds = await readJson<TiledTileset>(resolve(frontendRoot, 'hospital-beds.tsj'));
    expect(beds.tiles).toHaveLength(6);
    expect(beds.tiles.map((tile) => propertyValue(tile, 'segment'))).toEqual([
      'head',
      'middle',
      'foot',
      'head',
      'middle',
      'foot',
    ]);
    expect(beds.tiles.map((tile) => propertyValue(tile, 'style'))).toEqual([
      'clean',
      'clean',
      'clean',
      'used',
      'used',
      'used',
    ]);
    for (const tile of beds.tiles) {
      expect(tile.imagewidth).toBe(32);
      expect(tile.imageheight).toBe(64);
      expect(propertyValue(tile, 'collisionMode')).toBe('full-footprint');
      expect(tile.objectgroup).toBeDefined();
    }
  });

  it('uses explicit base footprints only for oversized floor-standing objects', async () => {
    for (const fileName of ['hospital-structure.tsj', 'hospital-props.tsj'] as const) {
      const tileset = await readJson<TiledTileset>(resolve(frontendRoot, fileName));
      for (const tile of tileset.tiles) {
        const collisionMode = propertyValue(tile, 'collisionMode');
        if (collisionMode === 'base') expect(tile.objectgroup).toBeDefined();
        if (collisionMode === 'none') expect(tile.objectgroup).toBeUndefined();
      }
    }
  });
});
