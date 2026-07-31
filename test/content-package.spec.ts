import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compileContentPackage } from '../src/content/content-package.js';
import type { ContentSnapshot } from '../src/content/content-validator.js';

const build = (): ContentSnapshot => {
  const mapId = randomUUID();
  const skillId = randomUUID();
  return {
    maps: [
      {
        id: mapId,
        key: 'map-a',
        name: 'Map A',
        width: 8,
        height: 8,
        spawnX: 1,
        spawnY: 1,
        tiledData: { layers: [] },
        version: Math.floor(Math.random() * 100) + 1,
      },
    ],
    portals: [],
    items: [],
    skills: [
      {
        id: skillId,
        key: 'skill-a',
        name: 'Skill A',
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
    quests: [],
    npcs: [
      {
        id: randomUUID(),
        mapId,
        key: 'npc-a',
        name: 'NPC A',
        x: 2,
        y: 2,
        dialogue: {},
      },
    ],
    mobs: [],
  };
};

describe('compileContentPackage', () => {
  it('returns the same hash for the same definitions with different database UUIDs and map versions', () => {
    expect(compileContentPackage(build()).hash).toBe(compileContentPackage(build()).hash);
  });

  it('changes the hash when a semantic definition changes', () => {
    const first = build();
    const second = structuredClone(first);
    second.maps[0]!.spawnX = 3;
    expect(compileContentPackage(second).hash).not.toBe(compileContentPackage(first).hash);
  });
});
