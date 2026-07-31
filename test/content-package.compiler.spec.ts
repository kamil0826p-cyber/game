import { describe, expect, it } from 'vitest';
import {
  diffContent,
  stableStringify,
  type CompiledContentManifest,
} from '../src/content/content-package.compiler.js';

function manifest(version: string, mapName = 'Map'): CompiledContentManifest {
  return {
    schemaVersion: 1,
    version,
    realm: { slug: 'world-1', name: 'World 1', defaultMapKey: 'map' },
    maps: [{
      key: 'map', name: mapName, width: 2, height: 2, zoneType: 'SAFE',
      spawnX: 0, spawnY: 0,
      tiledData: { width: 2, height: 2, tilewidth: 32, tileheight: 32, layers: [], tilesets: [] } as never,
      portals: [],
    }],
    items: [], npcs: [], mobs: [], skills: [], quests: [],
  };
}

describe('content package compiler helpers', () => {
  it('produces a stable hash input independent of object key order', () => {
    expect(stableStringify({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(stableStringify({ a: { c: 3, d: 4 }, b: 2 }));
  });

  it('marks map changes and removals as risky', () => {
    const diff = diffContent(manifest('1', 'Old'), manifest('2', 'New'));
    expect(diff.changed).toContain('map:map');
    expect(diff.risky).toContain('map:map');
  });

  it('is empty when the same manifest is deployed twice', () => {
    const current = manifest('1');
    expect(diffContent(current, current)).toEqual({ added: [], changed: [], removed: [], risky: [] });
  });
});
