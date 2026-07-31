import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  compileContentSnapshot,
  ContentValidationError,
  type ContentSnapshot,
} from '../src/content/content-validator.js';

const createSnapshot = (): ContentSnapshot => {
  const mapId = randomUUID();
  const itemId = randomUUID();
  const skillId = randomUUID();
  return {
    maps: [
      {
        id: mapId,
        key: 'test-map',
        name: 'Test Map',
        width: 10,
        height: 10,
        spawnX: 1,
        spawnY: 1,
        tiledData: { layers: [] },
        version: 1,
      },
    ],
    portals: [],
    items: [
      {
        id: itemId,
        key: 'test-item',
        name: 'Test Item',
        description: '',
        stackLimit: 10,
        metadata: { sellPriceSilver: 1 },
      },
    ],
    skills: [
      {
        id: skillId,
        key: 'test-skill',
        name: 'Test Skill',
        description: '',
        minimumLevel: 1,
        energyCost: 0,
        cooldownTurns: 0,
        maxRank: 1,
        effectDefinition: {},
        visualDefinition: {},
      },
    ],
    skillPrerequisites: [],
    quests: [
      {
        id: randomUUID(),
        key: 'test-quest',
        name: 'Test Quest',
        description: '',
        minimumLevel: 1,
        steps: [{ itemKey: 'test-item' }],
        rewards: {},
      },
    ],
    npcs: [
      {
        id: randomUUID(),
        mapId,
        key: 'test-npc',
        name: 'Test NPC',
        x: 2,
        y: 2,
        dialogue: {
          rootNodeId: 'root',
          nodes: {
            root: { choices: [{ nextNodeId: 'end' }] },
            end: { choices: [] },
          },
        },
      },
    ],
    mobs: [
      {
        id: randomUUID(),
        mapId,
        key: 'test-mob',
        name: 'Test Mob',
        x: 3,
        y: 3,
        level: 1,
        stats: { maxHp: 10 },
        lootTable: [{ itemKey: 'test-item', chance: 0.5, minQuantity: 1, maxQuantity: 2 }],
        respawnMs: 1000,
      },
    ],
  };
};

describe('compileContentSnapshot', () => {
  it('produces a stable hash regardless of top-level definition order', () => {
    const snapshot = createSnapshot();
    const first = compileContentSnapshot(snapshot);
    const second = compileContentSnapshot({
      ...snapshot,
      maps: [...snapshot.maps].reverse(),
      items: [...snapshot.items].reverse(),
    });
    expect(second.hash).toBe(first.hash);
  });

  it('rejects unknown item references and invalid drop ranges with exact paths', () => {
    const snapshot = createSnapshot();
    snapshot.mobs[0]!.lootTable = [
      { itemKey: 'missing-item', chance: 2, minQuantity: 3, maxQuantity: 1 },
    ];
    expect(() => compileContentSnapshot(snapshot)).toThrow(ContentValidationError);
    try {
      compileContentSnapshot(snapshot);
    } catch (error) {
      expect(error).toBeInstanceOf(ContentValidationError);
      const paths = (error as ContentValidationError).issues.map((issue) => issue.path);
      expect(paths).toContain('mobs.test-mob.lootTable[0].itemKey');
      expect(paths).toContain('mobs.test-mob.lootTable[0].chance');
    }
  });

  it('rejects missing and unreachable dialogue nodes', () => {
    const snapshot = createSnapshot();
    snapshot.npcs[0]!.dialogue = {
      rootNodeId: 'root',
      nodes: {
        root: { choices: [{ nextNodeId: 'missing' }] },
        orphan: { choices: [] },
      },
    };
    expect(() => compileContentSnapshot(snapshot)).toThrow(/missing dialogue node|unreachable/i);
  });

  it('rejects prerequisite cycles', () => {
    const snapshot = createSnapshot();
    const secondSkillId = randomUUID();
    snapshot.skills.push({
      ...snapshot.skills[0]!,
      id: secondSkillId,
      key: 'second-skill',
      name: 'Second Skill',
    });
    snapshot.skillPrerequisites.push(
      {
        skillDefinitionId: snapshot.skills[0]!.id,
        prerequisiteSkillDefinitionId: secondSkillId,
      },
      {
        skillDefinitionId: secondSkillId,
        prerequisiteSkillDefinitionId: snapshot.skills[0]!.id,
      },
    );
    expect(() => compileContentSnapshot(snapshot)).toThrow(/cycle/i);
  });
});
