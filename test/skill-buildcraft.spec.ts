import { describe, expect, it } from 'vitest';
import { SKILL_CATALOG } from '../src/modules/skills/skill.catalog.js';
import {
  SKILL_BUILD_CATALOG,
  findSkillBuildNode,
  skillSpecializationsForClass,
} from '../src/modules/skills/skill.buildcraft.catalog.js';
import {
  calculateBuildPoints,
  createInitialBuildData,
  rankMapFromLearned,
  resolveSkillDefinition,
  revalidateLoadouts,
  validateBuildCatalog,
  validateCompleteBuild,
  validateLoadout,
  validateRankUp,
} from '../src/modules/skills/skill.buildcraft.rules.js';
import type {
  SkillBuildCatalog,
  SkillLoadoutDefinition,
} from '../src/modules/skills/skill.buildcraft.types.js';

describe('skill buildcraft catalog', () => {
  it('contains three complete specializations for every class', () => {
    for (const characterClass of ['MAGE', 'WARRIOR', 'ARCHER'] as const) {
      const specializations = skillSpecializationsForClass(characterClass);
      expect(specializations).toHaveLength(3);
      for (const specialization of specializations) {
        expect(specialization.groupSynergies.length).toBeGreaterThanOrEqual(2);
        expect(specialization.soloLoop).not.toBe('');
        expect(specialization.threatResponse).not.toBe('');
        expect(specialization.drawback).not.toBe('');
      }
    }
    expect(validateBuildCatalog()).toEqual({ valid: true, errors: [] });
  });

  it('rejects semantically inconsistent typed modifiers', () => {
    const source = SKILL_BUILD_CATALOG.nodes.find(
      (node) => node.modifiersByRank && node.modifiersByRank.length > 0,
    )!;
    const broken: SkillBuildCatalog = {
      ...SKILL_BUILD_CATALOG,
      nodes: [
        ...SKILL_BUILD_CATALOG.nodes.filter((node) => node.key !== source.key),
        {
          ...source,
          modifiersByRank: [[{ version: 1, type: 'SCALE_EFFECT', effectType: 'DAMAGE', multiplier: 0 }]],
        },
      ],
    };
    const validation = validateBuildCatalog(broken);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain(`modifier rank mismatch: ${source.key}`);
    expect(validation.errors).toContain(`invalid effect multiplier: ${source.key}`);
  });

  it('detects cycles and unreachable prerequisites in authored content', () => {
    const first = SKILL_BUILD_CATALOG.nodes.find((node) => node.characterClass === 'MAGE')!;
    const broken: SkillBuildCatalog = {
      ...SKILL_BUILD_CATALOG,
      nodes: [
        ...SKILL_BUILD_CATALOG.nodes.filter((node) => node.key !== first.key),
        { ...first, prerequisiteKeys: ['missing-node', first.key] },
      ],
    };
    const validation = validateBuildCatalog(broken);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain(`unreachable prerequisite missing-node from ${first.key}`);
    expect(validation.errors).toContain(`cycle detected at ${first.key}`);
  });
});

describe('skill build progression', () => {
  it('supports ranks above one and enforces points, level and prerequisites', () => {
    expect(calculateBuildPoints(4, 0)).toMatchObject({ earned: 0, available: 0 });
    expect(calculateBuildPoints(5, 0)).toMatchObject({ earned: 1, available: 1 });
    expect(calculateBuildPoints(50, 4)).toMatchObject({ earned: 10, spent: 4, available: 6 });

    const root = findSkillBuildNode('mage-arcane-spark')!;
    expect(root.maxRank).toBeGreaterThan(1);
    expect(
      validateRankUp({
        characterClass: 'MAGE',
        characterLevel: 50,
        ranks: { [root.key]: 1 },
        nodeKey: root.key,
      }).valid,
    ).toBe(true);
  });

  it('enforces mutually exclusive technique and keystone choices', () => {
    const ranks = {
      'mage-arcanist-resonance': 2,
      'mage-arcanist-fractured-ray': 1,
    };
    const technique = validateRankUp({
      characterClass: 'MAGE',
      characterLevel: 60,
      selectedSpecializationKey: 'mage-arcanist',
      ranks,
      nodeKey: 'mage-arcanist-efficient-lock',
    });
    expect(technique.valid).toBe(false);
    expect(technique.reasons.some((reason) => reason.startsWith('CHOICE_CONFLICT'))).toBe(true);

    const complete = validateCompleteBuild({
      characterClass: 'MAGE',
      characterLevel: 100,
      selectedSpecializationKey: 'mage-arcanist',
      ranks: {
        ...ranks,
        'mage-arcanist-chrono-collapse': 1,
        'mage-pyromancer-kindling': 2,
        'mage-pyromancer-searing-lance': 1,
        'mage-pyromancer-ashen-verdict': 1,
      },
    });
    expect(complete.valid).toBe(false);
    expect(complete.reasons.some((reason) => reason.startsWith('SPECIALIZATION_REQUIRED'))).toBe(
      true,
    );
    expect(complete.reasons.some((reason) => reason.startsWith('CHOICE_CONFLICT'))).toBe(true);
  });
});

describe('loadout validation', () => {
  const learnedRanks = Object.fromEntries(
    SKILL_CATALOG.filter((skill) => skill.characterClass === 'MAGE').map((skill) => [skill.key, 1]),
  );

  it('accepts at most eight learned actions and validates passive budget separately', () => {
    expect(
      validateLoadout({
        characterClass: 'MAGE',
        selectedSpecializationKey: 'mage-arcanist',
        ranks: {
          ...learnedRanks,
          'mage-arcanist-resonance': 3,
          'mage-arcanist-fractured-ray': 1,
          'mage-arcanist-chrono-collapse': 1,
        },
        activeSkillKeys: Object.keys(learnedRanks).slice(0, 8),
        passiveNodeKeys: [
          'mage-arcanist-resonance',
          'mage-arcanist-fractured-ray',
          'mage-arcanist-chrono-collapse',
        ],
      }),
    ).toEqual([]);

    expect(
      validateLoadout({
        characterClass: 'MAGE',
        selectedSpecializationKey: 'mage-arcanist',
        ranks: {
          ...learnedRanks,
          'mage-arcanist-resonance': 3,
          'mage-arcanist-fractured-ray': 1,
          'mage-arcanist-chrono-collapse': 1,
        },
        activeSkillKeys: [...Object.keys(learnedRanks), 'unknown-ninth-action'],
        passiveNodeKeys: [
          'mage-arcanist-resonance',
          'mage-arcanist-fractured-ray',
          'mage-arcanist-chrono-collapse',
          'mage-arcanist-efficient-lock',
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        'TOO_MANY_ACTIVE_ACTIONS',
        'UNKNOWN_SKILL',
        'PASSIVE_NOT_LEARNED',
      ]),
    );

    expect(
      validateLoadout({
        characterClass: 'MAGE',
        selectedSpecializationKey: 'mage-arcanist',
        ranks: {
          ...learnedRanks,
          'mage-arcanist-resonance': 3,
          'mage-arcanist-fractured-ray': 1,
          'mage-arcanist-efficient-lock': 1,
          'mage-arcanist-chrono-collapse': 1,
        },
        activeSkillKeys: Object.keys(learnedRanks).slice(0, 8),
        passiveNodeKeys: [
          'mage-arcanist-resonance',
          'mage-arcanist-fractured-ray',
          'mage-arcanist-efficient-lock',
          'mage-arcanist-chrono-collapse',
        ],
      }),
    ).toContain('PASSIVE_BUDGET_EXCEEDED');
  });

  it('marks invalid loadouts without silently changing their contents', () => {
    const loadout: SkillLoadoutDefinition = {
      id: 'preserved',
      name: 'Preserved',
      activeSkillKeys: ['mage-arcane-spark', 'mage-meteor'],
      passiveNodeKeys: ['mage-pyromancer-kindling'],
      fallbackAction: 'DEFEND',
      version: 4,
      isValid: true,
      invalidReasons: [],
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
    const [validated] = revalidateLoadouts({
      characterClass: 'MAGE',
      selectedSpecializationKey: 'mage-arcanist',
      ranks: { 'mage-arcane-spark': 1 },
      loadouts: [loadout],
    });
    expect(validated?.isValid).toBe(false);
    expect(validated?.activeSkillKeys).toEqual(loadout.activeSkillKeys);
    expect(validated?.passiveNodeKeys).toEqual(loadout.passiveNodeKeys);
    expect(validated?.version).toBe(4);
  });
});

describe('typed combat modifiers', () => {
  it('applies rank scaling, targeting, cost and formation modifiers deterministically', () => {
    const ranks = {
      'mage-arcane-spark': 3,
      'mage-arcanist-resonance': 2,
      'mage-arcanist-fractured-ray': 1,
      'mage-time-lock': 1,
      'mage-arcanist-efficient-lock': 1,
    };
    const spark = resolveSkillDefinition({
      skillKey: 'mage-arcane-spark',
      activeRank: 3,
      passiveNodeKeys: ['mage-arcanist-resonance', 'mage-arcanist-fractured-ray'],
      ranks,
    })!;
    const baseSpark = SKILL_CATALOG.find((skill) => skill.key === 'mage-arcane-spark')!;
    expect(spark.targeting).toBe('BACK_ROW');
    const sparkDamage = spark.effects.find((effect) => effect.type === 'DAMAGE');
    const baseDamage = baseSpark.effects.find((effect) => effect.type === 'DAMAGE');
    expect(sparkDamage?.type).toBe('DAMAGE');
    expect(baseDamage?.type).toBe('DAMAGE');
    if (sparkDamage?.type !== 'DAMAGE' || baseDamage?.type !== 'DAMAGE') {
      throw new Error('Expected Arcane Spark to contain a damage effect.');
    }
    expect(sparkDamage.coefficient).toBeGreaterThan(baseDamage.coefficient);

    const timeLock = resolveSkillDefinition({
      skillKey: 'mage-time-lock',
      activeRank: 1,
      passiveNodeKeys: ['mage-arcanist-efficient-lock'],
      ranks,
    })!;
    const baseTimeLock = SKILL_CATALOG.find((skill) => skill.key === 'mage-time-lock')!;
    expect(timeLock.energyCost).toBeLessThan(baseTimeLock.energyCost);

    const pvp = resolveSkillDefinition({
      skillKey: 'mage-arcane-spark',
      activeRank: 3,
      passiveNodeKeys: ['mage-arcanist-resonance', 'mage-arcanist-fractured-ray'],
      ranks,
    });
    const pve = resolveSkillDefinition({
      skillKey: 'mage-arcane-spark',
      activeRank: 3,
      passiveNodeKeys: ['mage-arcanist-resonance', 'mage-arcanist-fractured-ray'],
      ranks,
    });
    expect(pvp).toEqual(pve);
  });
});

describe('legacy migration', () => {
  it('preserves ranks and cooldowns, creates an eight-action default and grants a free respec', () => {
    const learned = SKILL_CATALOG.filter((skill) => skill.characterClass === 'MAGE').map(
      (skill, index) => ({
        skillKey: skill.key,
        rank: index === 0 ? 3 : 1,
        cooldownTurnsRemaining: index,
      }),
    );
    const data = createInitialBuildData(learned, '2026-08-01T00:00:00.000Z');
    expect(data.migration.backup).toEqual(learned);
    expect(data.loadouts[0]?.activeSkillKeys).toEqual(learned.slice(0, 8).map((entry) => entry.skillKey));
    expect(data.freeRespecAvailable).toBe(true);
    expect(rankMapFromLearned(learned, data.nodeRanks)['mage-arcane-spark']).toBe(3);
  });
});
