import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileCollisionGrid, extractEmbeddedPortals, parseTiledMap } from '../src/modules/maps/tiled-map.parser.js';

const mapNames = ['greenfields', 'crystal-cave', 'ashen-infirmary'] as const;
const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8')) as unknown;

describe('committed Tiled map assets', () => {
  for (const mapName of mapNames) {
    it(`${mapName} is valid and synchronized with the browser copy`, async () => {
      const backendPath = resolve('prisma', 'maps', `${mapName}.json`);
      const frontendPath = resolve('frontend', 'public', 'maps', `${mapName}.json`);
      const [backendSource, frontendSource] = await Promise.all([readJson(backendPath), readJson(frontendPath)]);

      expect(frontendSource).toEqual(backendSource);
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

  it('ashen-infirmary SVG atlas keeps all tiles self-contained', async () => {
    const svg = await readFile(
      resolve('frontend', 'public', 'assets', 'tiles', 'ashen-infirmary.svg'),
      'utf8',
    );
    expect(svg.match(/data-tile-id=/g) ?? []).toHaveLength(24);
    expect(svg).not.toContain('url(#');
  });

});
