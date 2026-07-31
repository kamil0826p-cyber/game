import { describe, expect, it } from 'vitest';
import {
  diffContent,
  stableStringify,
  validateCompiledManifest,
  type CompiledContentManifest,
} from '../src/content/content-package.compiler.js';

function manifest(version: string, mapName = 'Map'): CompiledContentManifest {
  return {
    schemaVersion: 2,
    version,
    realm: { slug: 'world-1', name: 'World 1', defaultMapKey: 'map' },
    maps: [{
      key: 'map', name: mapName, width: 2, height: 2, zoneType: 'SAFE',
      spawnX: 0, spawnY: 0,
      tiledData: { width: 2, height: 2, tilewidth: 32, tileheight: 32, layers: [], tilesets: [] } as never,
      portals: [],
    }],
    items: [], npcs: [], mobs: [], skills: [], quests: [], encounters: [], recipes: [], expeditions: [],
  };
}

describe('content package compiler helpers', () => {
  it('produces stable source input independent of object key order', () => {
    expect(stableStringify({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(stableStringify({ a: { c: 3, d: 4 }, b: 2 }));
  });

  it('returns detailed risky patches for map changes', () => {
    const diff = diffContent(manifest('1', 'Old'), manifest('2', 'New'));
    expect(diff.changed).toContain('map:map');
    expect(diff.risky).toContain('map:map');
    expect(diff.entries).toContainEqual(expect.objectContaining({
      entityKey: 'map:map', changeType: 'CHANGED', risky: true,
    }));
  });

  it('is empty when the same manifest is deployed twice', () => {
    const current = manifest('1');
    expect(diffContent(current, current)).toEqual({
      added: [], changed: [], removed: [], risky: [], entries: [],
    });
  });

  it('rejects a missing merchant item reference', () => {
    const value = manifest('1');
    value.npcs.push({
      key: 'merchant', name: 'Merchant', mapKey: 'map', x: 1, y: 1, outfitKey: 'npc',
      dialogue: {
        type: 'MERCHANT', rootNodeId: 'root',
        nodes: { root: { choices: [{ id: 'buy', action: 'OPEN_MERCHANT' }] } },
        merchant: { itemKeys: ['missing-item'] },
      },
    });
    expect(() => validateCompiledManifest(value)).toThrow('missing merchant item');
  });

  it('rejects unreachable dialogue nodes', () => {
    const value = manifest('1');
    value.npcs.push({
      key: 'npc', name: 'NPC', mapKey: 'map', x: 1, y: 1, outfitKey: 'npc',
      dialogue: {
        type: 'DIALOGUE', rootNodeId: 'root',
        nodes: { root: { choices: [] }, orphan: { choices: [] } },
      },
    });
    expect(() => validateCompiledManifest(value)).toThrow('unreachable');
  });
});
