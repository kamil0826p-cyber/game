import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileMapDefinition, parseTiledMap } from '../src/game/map/tiledMap';

const loadFixture = async (name: string) => {
  const raw = await readFile(resolve(process.cwd(), 'public/maps', name), 'utf8');
  return compileMapDefinition(name.replace('.json', ''), parseTiledMap(JSON.parse(raw)));
};

describe('Tiled map compiler', () => {
  it('keeps browser and authoritative map files byte-identical', async () => {
    for (const name of ['greenfields.json', 'crystal-cave.json']) {
      const browser = await readFile(resolve(process.cwd(), 'public/maps', name), 'utf8');
      const authoritative = await readFile(resolve(process.cwd(), '..', 'prisma/maps', name), 'utf8');
      expect(browser).toBe(authoritative);
    }
  });

  it('compiles Greenfields with three tilesets and foreground layers', async () => {
    const map = await loadFixture('greenfields.json');
    expect([map.width, map.height]).toEqual([20, 15]);
    expect(map.source.tilesets).toHaveLength(3);
    expect(map.renderLayers.some((layer) => layer.plane === 'above-entities')).toBe(true);
    expect(map.portals).toEqual([
      { sourceX: 18, sourceY: 7, destinationMapKey: 'crystal-cave', targetX: 1, targetY: 7 },
    ]);
  });

  it('blocks a tree trunk but not its canopy-only cells', async () => {
    const map = await loadFixture('greenfields.json');
    expect(map.collision[3 * map.width + 12]).toBe(1);
    expect(map.collision[2 * map.width + 11]).toBe(0);
    expect(map.collision[2 * map.width + 12]).toBe(0);
  });

  it('combines tile and object collisions in Crystal Cave', async () => {
    const map = await loadFixture('crystal-cave.json');
    expect([map.width, map.height]).toEqual([18, 14]);
    expect(map.source.tilesets).toHaveLength(2);
    expect(map.collision[6 * map.width + 5]).toBe(1);
    expect(map.collision[6 * map.width + 8]).toBe(1);
    expect(map.collision[7 * map.width + 8]).toBe(0);
    expect(map.portals).toEqual([
      { sourceX: 1, sourceY: 7, destinationMapKey: 'greenfields', targetX: 17, targetY: 7 },
    ]);
  });
});
