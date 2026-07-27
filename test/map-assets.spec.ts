import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileCollisionGrid, extractEmbeddedPortals, parseTiledMap } from '../src/modules/maps/tiled-map.parser.js';

const mapNames = ['greenfields', 'crystal-cave'] as const;

const readJson = async (path: string): Promise<unknown> => JSON.parse(await readFile(path, 'utf8')) as unknown;

describe('committed Tiled map assets', () => {
  for (const mapName of mapNames) {
    it(`${mapName} is valid and synchronized with the browser copy`, async () => {
      const backendPath = resolve('prisma', 'maps', `${mapName}.json`);
      const frontendPath = resolve('frontend', 'public', 'maps', `${mapName}.json`);
      const [backendSource, frontendSource] = await Promise.all([
        readJson(backendPath),
        readJson(frontendPath),
      ]);

      expect(frontendSource).toEqual(backendSource);
      const map = parseTiledMap(backendSource);
      expect(map.layers.filter((layer) => layer.type === 'tilelayer')).not.toHaveLength(0);
      expect(compileCollisionGrid(map)).toHaveLength(map.width * map.height);
      expect(extractEmbeddedPortals(map)).toHaveLength(1);
    });
  }
});
