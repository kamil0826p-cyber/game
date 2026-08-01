import { describe, expect, it } from 'vitest';
import {
  logicalContentDiff,
  stableContentHash,
} from '../../src/foundation/content/content.canonical.js';
import type { ContentManifest } from '../../src/foundation/content/content.types.js';
import { validateContentManifest } from '../../src/foundation/content/content.validator.js';

const validManifest = (): ContentManifest => ({
  schemaVersion: 1,
  maps: [{ key: 'field', width: 20, height: 20 }],
  portals: [],
  npcs: [
    {
      key: 'guide',
      mapKey: 'field',
      x: 1,
      y: 1,
      rootNodeId: 'hello',
      nodes: [{ id: 'hello', choices: [{ id: 'bye' }] }],
    },
  ],
  quests: [
    {
      key: 'gather',
      objectives: [
        { id: 'collect', type: 'COLLECT_ITEM', itemKey: 'herb', quantity: 2 },
      ],
      rewards: {
        experience: 10,
        silver: 5,
        items: [{ itemKey: 'potion', quantity: 1 }],
      },
    },
  ],
  mobs: [
    {
      key: 'rat',
      mapKey: 'field',
      spawnPoints: [{ x: 5, y: 5 }],
      lootTableKey: 'rat-loot',
    },
  ],
  encounters: [{ key: 'rat-pack', mobKeys: ['rat'] }],
  skills: [
    { key: 'strike', prerequisiteKeys: [] },
    { key: 'heavy-strike', prerequisiteKeys: ['strike'] },
  ],
  items: [{ key: 'herb' }, { key: 'potion' }],
  lootTables: [
    {
      key: 'rat-loot',
      entries: [{ itemKey: 'herb', chance: 0.5, minQuantity: 1, maxQuantity: 2 }],
    },
  ],
  recipes: [
    {
      key: 'brew-potion',
      ingredients: [{ itemKey: 'herb', quantity: 2 }],
      result: { itemKey: 'potion', quantity: 1 },
    },
  ],
  expeditions: [],
  modifiers: [],
});

describe('versioned content foundation', () => {
  it('produces a stable hash independent of record order, object key order and database ids', () => {
    const left = {
      items: [
        { key: 'b', value: 2, databaseId: 'random-b' },
        { key: 'a', value: 1, databaseId: 'random-a' },
      ],
      nested: { z: true, a: false },
    };
    const right = {
      nested: { a: false, z: true },
      items: [
        { value: 1, key: 'a', databaseId: 'another-a' },
        { value: 2, key: 'b', databaseId: 'another-b' },
      ],
    };
    expect(stableContentHash(left)).toBe(stableContentHash(right));
  });

  it('accepts a fully connected manifest', () => {
    expect(validateContentManifest(validManifest())).toEqual([]);
  });

  it('rejects missing references before deployment', () => {
    const manifest = validManifest();
    const broken: ContentManifest = {
      ...manifest,
      quests: [
        {
          ...manifest.quests[0]!,
          objectives: [
            { id: 'collect', type: 'COLLECT_ITEM', itemKey: 'missing', quantity: 1 },
          ],
        },
      ],
    };
    expect(validateContentManifest(broken)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'MISSING_REFERENCE' })]),
    );
  });

  it('detects skill cycles and unreachable dialogue nodes', () => {
    const manifest = validManifest();
    const broken: ContentManifest = {
      ...manifest,
      skills: [
        { key: 'a', prerequisiteKeys: ['b'] },
        { key: 'b', prerequisiteKeys: ['a'] },
      ],
      npcs: [
        {
          key: 'guide',
          mapKey: 'field',
          rootNodeId: 'hello',
          nodes: [
            { id: 'hello', choices: [] },
            { id: 'orphan', choices: [] },
          ],
        },
      ],
    };
    const issues = validateContentManifest(broken);
    expect(issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'CYCLE' })]),
    );
    expect(issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'UNREACHABLE_NODE' })]),
    );
  });

  it('detects collisions across portals, NPCs and mob spawn points', () => {
    const manifest = validManifest();
    const broken: ContentManifest = {
      ...manifest,
      portals: [
        {
          key: 'field-exit',
          sourceMapKey: 'field',
          destinationMapKey: 'field',
          sourceX: 1,
          sourceY: 1,
          targetX: 2,
          targetY: 2,
        },
      ],
      mobs: [
        {
          key: 'rat',
          mapKey: 'field',
          spawnPoints: [{ x: 1, y: 1 }],
          lootTableKey: 'rat-loot',
        },
      ],
    };
    const collisions = validateContentManifest(broken).filter(
      (issue) => issue.code === 'POSITION_COLLISION',
    );
    expect(collisions).toHaveLength(2);
  });

  it('returns a logical per-category diff', () => {
    const diff = logicalContentDiff(
      [
        { category: 'items', key: 'old', payload: { value: 1 } },
        { category: 'items', key: 'changed', payload: { value: 1 } },
      ],
      [
        { category: 'items', key: 'new', payload: { value: 1 } },
        { category: 'items', key: 'changed', payload: { value: 2 } },
      ],
    );
    expect(diff).toEqual({
      added: { items: ['new'] },
      removed: { items: ['old'] },
      changed: { items: ['changed'] },
    });
  });
});
