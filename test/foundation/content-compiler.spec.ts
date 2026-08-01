import { describe, expect, it } from 'vitest';
import {
  compileContentManifest,
  ContentValidationError,
} from '../../src/foundation/content/content.compiler.js';
import type { GameContentManifest } from '../../src/foundation/content/content.types.js';

function manifest(): GameContentManifest {
  return {
    schemaVersion: 1,
    defaultMapKey: 'map-a',
    maps: [
      {
        key: 'map-a',
        name: 'Map A',
        width: 10,
        height: 10,
        zoneType: 'SAFE',
        spawnX: 0,
        spawnY: 0,
        tiledData: { id: '9a8f9c24-ea69-44b9-9dca-a9002f21bffa', layers: [] },
      },
    ],
    portals: [],
    npcs: [
      {
        key: 'merchant',
        mapKey: 'map-a',
        name: 'Merchant',
        x: 2,
        y: 2,
        outfitKey: 'merchant',
        dialogue: {
          rootNodeId: 'root',
          nodes: {
            root: { choices: [{ id: 'shop', action: 'OPEN_MERCHANT' }] },
          },
          merchant: { itemKeys: ['potion'] },
        },
      },
    ],
    quests: [
      {
        key: 'quest-a',
        name: 'Quest',
        description: 'Collect one item.',
        minimumLevel: 1,
        steps: [{ id: 'collect', type: 'COLLECT_ITEM', itemKey: 'potion', quantity: 1 }],
        rewards: { experience: 10, silver: 5 },
      },
    ],
    mobs: [
      {
        key: 'mob-a',
        mapKey: 'map-a',
        name: 'Mob',
        x: 1,
        y: 1,
        level: 1,
        outfitKey: 'mob',
        stats: { maxHp: 10 },
        lootTableKey: 'loot-a',
        respawnMs: 1_000,
      },
    ],
    encounters: [
      {
        key: 'encounter-a',
        mapKey: 'map-a',
        actors: [{ mobKey: 'mob-a', count: 1 }],
        minimumPlayers: 1,
        maximumPlayers: 10,
      },
    ],
    skills: [
      {
        key: 'skill-a',
        name: 'Skill',
        description: 'Skill',
        requiredClass: 'MAGE',
        minimumLevel: 1,
        energyCost: 1,
        cooldownTurns: 1,
        targeting: 'ENEMY',
        maxRank: 1,
        displayOrder: 1,
        treeRow: 0,
        treeColumn: 0,
        icon: 'x',
        animationKey: 'skill-a',
        prerequisiteKeys: [],
        effectDefinition: { operations: [] },
        visualDefinition: {},
      },
    ],
    items: [
      {
        key: 'potion',
        name: 'Potion',
        description: 'Potion',
        stackLimit: 20,
        metadata: { category: 'CONSUMABLE' },
      },
    ],
    lootTables: [
      {
        key: 'loot-a',
        entries: [{ itemKey: 'potion', chance: 0.5, minQuantity: 1, maxQuantity: 1 }],
      },
    ],
    recipes: [],
    expeditions: [],
    modifiers: [],
  };
}

describe('content compiler', () => {
  it('produces the same hash regardless of record order and generated UUIDs', () => {
    const first = manifest();
    const second = manifest();
    second.maps = second.maps.map((map) => ({
      ...map,
      tiledData: { id: 'b7266c50-f40d-42af-b8a1-c57a0d903eee', layers: [] },
    }));
    second.items = [...second.items].reverse();
    second.skills = second.skills.map((skill) => ({ ...skill, prerequisiteKeys: [...skill.prerequisiteKeys].reverse() }));
    expect(compileContentManifest(first).hash).toBe(compileContentManifest(second).hash);
  });

  it('reports a logical diff by stable keys', () => {
    const before = manifest();
    const after = manifest();
    after.items = [
      { ...after.items[0]!, description: 'Changed' },
      { key: 'new-item', name: 'New', description: 'New', stackLimit: 1, metadata: {} },
    ];
    const compiled = compileContentManifest(after, before);
    expect(compiled.logicalDiff.items.changed).toEqual(['potion']);
    expect(compiled.logicalDiff.items.added).toEqual(['new-item']);
  });

  it('blocks missing references before deployment', () => {
    const invalid = manifest();
    invalid.mobs = [{ ...invalid.mobs[0]!, lootTableKey: 'missing' }];
    expect(() => compileContentManifest(invalid)).toThrow(ContentValidationError);
  });

  it('blocks coordinate collisions and illegal rewards', () => {
    const invalid = manifest();
    invalid.npcs = [{ ...invalid.npcs[0]!, x: 1, y: 1 }];
    invalid.quests = [{ ...invalid.quests[0]!, rewards: { silver: -1 } }];
    expect(() => compileContentManifest(invalid)).toThrow(/Coordinate collision/);
    expect(() => compileContentManifest(invalid)).toThrow(/illegal negative/);
  });

  it('blocks cycles and unreachable dialogue nodes', () => {
    const invalid = manifest();
    invalid.npcs = [
      {
        ...invalid.npcs[0]!,
        dialogue: {
          rootNodeId: 'a',
          nodes: {
            a: { choices: [{ id: 'to-b', nextNodeId: 'b' }] },
            b: { choices: [{ id: 'to-a', nextNodeId: 'a' }] },
            orphan: {},
          },
        },
      },
    ];
    expect(() => compileContentManifest(invalid)).toThrow(/cycle/);
    expect(() => compileContentManifest(invalid)).toThrow(/unreachable/);
  });

  it('blocks skill prerequisite cycles', () => {
    const invalid = manifest();
    invalid.skills = [
      { ...invalid.skills[0]!, prerequisiteKeys: ['skill-b'] },
      { ...invalid.skills[0]!, key: 'skill-b', prerequisiteKeys: ['skill-a'] },
    ];
    expect(() => compileContentManifest(invalid)).toThrow(/Skill prerequisites contain cycle/);
  });
});
