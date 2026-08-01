import type { CharacterClass } from '../../common/domain/game.types.js';
import {
  PROGRESSION_MILESTONE_INTERVAL,
  PROGRESSION_NODE_KEYS,
  PROGRESSION_VERSION,
  type ProgressionNodeDefinition,
  type ProgressionNodeKey,
  type ProgressionSnapshot,
  type StatVector,
} from './progression.types.js';

export const ZERO_STATS: Readonly<StatVector> = Object.freeze({
  maxHp: 0,
  maxEnergy: 0,
  strength: 0,
  agility: 0,
  intelligence: 0,
  armor: 0,
});

export const CLASS_BASE_STATS: Readonly<Record<CharacterClass, StatVector>> = Object.freeze({
  MAGE: { maxHp: 75, maxEnergy: 120, strength: 4, agility: 7, intelligence: 14, armor: 2 },
  WARRIOR: { maxHp: 130, maxEnergy: 70, strength: 14, agility: 7, intelligence: 3, armor: 8 },
  ARCHER: { maxHp: 95, maxEnergy: 95, strength: 7, agility: 14, intelligence: 5, armor: 4 },
});

const CLASS_GROWTH: Readonly<Record<CharacterClass, Readonly<Record<keyof StatVector, readonly [number, number]>>>> = Object.freeze({
  MAGE: {
    maxHp: [6, 1], maxEnergy: [6, 1], strength: [1, 5], agility: [9, 20], intelligence: [27, 20], armor: [1, 4],
  },
  WARRIOR: {
    maxHp: [11, 1], maxEnergy: [5, 2], strength: [27, 20], agility: [9, 20], intelligence: [3, 20], armor: [7, 10],
  },
  ARCHER: {
    maxHp: [8, 1], maxEnergy: [4, 1], strength: [11, 20], agility: [27, 20], intelligence: [3, 10], armor: [9, 20],
  },
});

export const PROGRESSION_NODES: Readonly<Record<ProgressionNodeKey, ProgressionNodeDefinition>> = Object.freeze({
  ENDURANCE: {
    key: 'ENDURANCE',
    name: 'Endurance',
    description: 'More health and a small armor increase.',
    maxRank: 8,
    bonusesPerRank: { maxHp: 34, maxEnergy: 0, strength: 0, agility: 0, intelligence: 0, armor: 1 },
  },
  PRECISION: {
    key: 'PRECISION',
    name: 'Precision',
    description: 'Improves physical accuracy profiles through strength and agility.',
    maxRank: 8,
    bonusesPerRank: { maxHp: 0, maxEnergy: 0, strength: 1, agility: 2, intelligence: 0, armor: 0 },
  },
  RITUAL_KNOWLEDGE: {
    key: 'RITUAL_KNOWLEDGE',
    name: 'Ritual knowledge',
    description: 'Improves spell power and the energy pool.',
    maxRank: 8,
    bonusesPerRank: { maxHp: 0, maxEnergy: 16, strength: 0, agility: 0, intelligence: 2, armor: 0 },
  },
  MOBILITY: {
    key: 'MOBILITY',
    name: 'Mobility',
    description: 'Improves agility and sustained energy.',
    maxRank: 8,
    bonusesPerRank: { maxHp: 0, maxEnergy: 9, strength: 0, agility: 1, intelligence: 0, armor: 0 },
  },
  CONTROL: {
    key: 'CONTROL',
    name: 'Control',
    description: 'A balanced defensive and magical control profile.',
    maxRank: 8,
    bonusesPerRank: { maxHp: 14, maxEnergy: 0, strength: 0, agility: 0, intelligence: 1, armor: 1 },
  },
});

const STAT_KEYS = ['maxHp', 'maxEnergy', 'strength', 'agility', 'intelligence', 'armor'] as const;

export function normalizeStatVector(value: unknown): StatVector {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.fromEntries(STAT_KEYS.map((key) => {
    const raw = source[key];
    return [key, Number.isFinite(raw) ? Math.trunc(Number(raw)) : 0];
  })) as unknown as StatVector;
}

export function addStatVectors(...values: readonly StatVector[]): StatVector {
  return values.reduce<StatVector>((sum, value) => ({
    maxHp: sum.maxHp + value.maxHp,
    maxEnergy: sum.maxEnergy + value.maxEnergy,
    strength: sum.strength + value.strength,
    agility: sum.agility + value.agility,
    intelligence: sum.intelligence + value.intelligence,
    armor: sum.armor + value.armor,
  }), { ...ZERO_STATS });
}

export function subtractStatVectors(left: StatVector, ...right: readonly StatVector[]): StatVector {
  const negative = right.map((value) => ({
    maxHp: -value.maxHp,
    maxEnergy: -value.maxEnergy,
    strength: -value.strength,
    agility: -value.agility,
    intelligence: -value.intelligence,
    armor: -value.armor,
  }));
  return addStatVectors(left, ...negative);
}

export function baseStatsForClass(characterClass: CharacterClass): StatVector {
  return { ...CLASS_BASE_STATS[characterClass] };
}

export function automaticProgressionForLevel(characterClass: CharacterClass, level: number): StatVector {
  const completedLevels = Math.max(0, Math.min(99, Math.floor(level) - 1));
  const growth = CLASS_GROWTH[characterClass];
  const scaled = (key: keyof StatVector): number => {
    const [numerator, denominator] = growth[key];
    return Math.floor(completedLevels * numerator / denominator);
  };
  return {
    maxHp: scaled('maxHp'),
    maxEnergy: scaled('maxEnergy'),
    strength: scaled('strength'),
    agility: scaled('agility'),
    intelligence: scaled('intelligence'),
    armor: scaled('armor'),
  };
}

export function progressionPointsForLevel(level: number): number {
  return Math.floor(Math.max(1, Math.min(100, Math.floor(level))) / PROGRESSION_MILESTONE_INTERVAL);
}

export function parseProgressionChoices(value: unknown): ProgressionNodeKey[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ProgressionNodeKey =>
    typeof entry === 'string' && PROGRESSION_NODE_KEYS.includes(entry as ProgressionNodeKey));
}

export function nodeRanks(choices: readonly ProgressionNodeKey[]): Record<ProgressionNodeKey, number> {
  const ranks = Object.fromEntries(PROGRESSION_NODE_KEYS.map((key) => [key, 0])) as Record<ProgressionNodeKey, number>;
  for (const choice of choices) ranks[choice] += 1;
  return ranks;
}

export function milestoneBonuses(choices: readonly ProgressionNodeKey[]): StatVector {
  return choices.reduce<StatVector>((sum, key) => addStatVectors(sum, PROGRESSION_NODES[key].bonusesPerRank), { ...ZERO_STATS });
}

function diminished(value: number, softCap: number, hardCap: number, numerator: number, denominator: number): number {
  if (value <= softCap) return Math.max(0, value);
  return Math.min(hardCap, softCap + Math.floor((value - softCap) * numerator / denominator));
}

export function respecSilverCost(level: number, choices: readonly ProgressionNodeKey[], freeRespecs: number): number {
  if (freeRespecs > 0 || choices.length === 0) return 0;
  return 500 + Math.max(1, Math.floor(level)) * 50 + choices.length * 100;
}

export function calculateCharacterStats(input: {
  characterClass: CharacterClass;
  level: number;
  choices?: unknown;
  legacyAdjustment?: unknown;
  equipment?: unknown;
  temporary?: unknown;
  freeRespecs?: number;
}): ProgressionSnapshot {
  const level = Math.max(1, Math.min(100, Math.floor(input.level)));
  const choices = parseProgressionChoices(input.choices);
  const earned = progressionPointsForLevel(level);
  const acceptedChoices: ProgressionNodeKey[] = [];
  const ranks = nodeRanks([]);
  for (const choice of choices.slice(0, earned)) {
    if (ranks[choice] >= PROGRESSION_NODES[choice].maxRank) continue;
    ranks[choice] += 1;
    acceptedChoices.push(choice);
  }
  const base = baseStatsForClass(input.characterClass);
  const automaticProgression = automaticProgressionForLevel(input.characterClass, level);
  const milestoneChoices = milestoneBonuses(acceptedChoices);
  const legacyAdjustment = normalizeStatVector(input.legacyAdjustment);
  const equipment = normalizeStatVector(input.equipment);
  const temporary = normalizeStatVector(input.temporary);
  const effective = addStatVectors(base, automaticProgression, milestoneChoices, legacyAdjustment, equipment, temporary);
  effective.maxHp = Math.max(1, effective.maxHp);
  effective.maxEnergy = Math.max(0, effective.maxEnergy);
  effective.strength = Math.max(0, effective.strength);
  effective.agility = Math.max(0, effective.agility);
  effective.intelligence = Math.max(0, effective.intelligence);
  effective.armor = Math.max(0, effective.armor);
  const physicalPower = diminished(effective.strength, 80, 140, 1, 2);
  const rangedPower = diminished(effective.agility, 80, 140, 1, 2);
  const spellPower = diminished(effective.intelligence, 80, 140, 1, 2);
  const armorForMitigation = diminished(effective.armor, 60, 100, 2, 5);
  const damageReductionBasisPoints = Math.min(7500, Math.round(armorForMitigation / (armorForMitigation + 100) * 10_000));
  const freeRespecs = Math.max(0, Math.floor(input.freeRespecs ?? 0));
  return {
    version: PROGRESSION_VERSION,
    characterClass: input.characterClass,
    level,
    choices: acceptedChoices,
    nodeRanks: nodeRanks(acceptedChoices),
    points: {
      earned,
      spent: acceptedChoices.length,
      available: Math.max(0, earned - acceptedChoices.length),
      ...(level < 100 ? { nextPointAtLevel: (earned + 1) * PROGRESSION_MILESTONE_INTERVAL } : {}),
    },
    sources: { base, automaticProgression, milestoneChoices, legacyAdjustment, equipment, temporary },
    effective,
    derived: {
      physicalPower,
      rangedPower,
      spellPower,
      damageReductionBasisPoints,
      effectiveHealth: Math.round(effective.maxHp / Math.max(0.25, 1 - damageReductionBasisPoints / 10_000)),
    },
    limits: {
      primarySoftCap: 80,
      primaryHardCap: 140,
      armorSoftCap: 60,
      armorHardCap: 100,
      explanation: 'Displayed attributes are exact source sums. Combat power above the soft cap receives 50%, armor above its soft cap receives 40%, and derived mitigation is capped at 75%.',
    },
    respec: {
      freeRespecs,
      silverCost: respecSilverCost(level, acceptedChoices, freeRespecs),
      allowed: true,
    },
  };
}

export function statVectorsEqual(left: StatVector, right: StatVector): boolean {
  return STAT_KEYS.every((key) => left[key] === right[key]);
}
