import type { CharacterClass } from '../../../common/domain/game.types.js';

export const PROGRESSION_RULES_VERSION = 1;
export const CLASS_CURVE_VERSION = 1;
export const MILESTONE_DEFINITION_VERSION = 1;
export const RESPEC_COST_VERSION = 1;
export const MAX_CHARACTER_LEVEL = 100;
export const MILESTONE_INTERVAL_LEVELS = 5;
export const RESOURCE_RECOMPUTE_POLICY = 'PRESERVE_RATIO' as const;

export const PROGRESSION_STAT_KEYS = [
  'maxHp',
  'maxEnergy',
  'strength',
  'agility',
  'intelligence',
  'armor',
] as const;
export type ProgressionStatKey = (typeof PROGRESSION_STAT_KEYS)[number];
export type ProgressionStatVector = Record<ProgressionStatKey, number>;

export const ZERO_PROGRESSION_STATS: Readonly<ProgressionStatVector> = Object.freeze({
  maxHp: 0,
  maxEnergy: 0,
  strength: 0,
  agility: 0,
  intelligence: 0,
  armor: 0,
});

export const BASE_CLASS_STATS: Readonly<Record<CharacterClass, ProgressionStatVector>> = {
  MAGE: { maxHp: 75, maxEnergy: 120, strength: 4, agility: 7, intelligence: 14, armor: 2 },
  WARRIOR: { maxHp: 130, maxEnergy: 70, strength: 14, agility: 7, intelligence: 3, armor: 8 },
  ARCHER: { maxHp: 95, maxEnergy: 95, strength: 7, agility: 14, intelligence: 5, armor: 4 },
};

interface GrowthCoefficient {
  linear: number;
  quadratic: number;
}

type ClassGrowthCurve = Record<ProgressionStatKey, GrowthCoefficient>;

export const CLASS_GROWTH_CURVES: Readonly<Record<CharacterClass, ClassGrowthCurve>> = {
  MAGE: {
    maxHp: { linear: 7.4, quadratic: 0.014 },
    maxEnergy: { linear: 7.8, quadratic: 0.012 },
    strength: { linear: 0.35, quadratic: 0.0008 },
    agility: { linear: 0.75, quadratic: 0.0013 },
    intelligence: { linear: 1.55, quadratic: 0.0028 },
    armor: { linear: 0.35, quadratic: 0.0006 },
  },
  WARRIOR: {
    maxHp: { linear: 11.5, quadratic: 0.022 },
    maxEnergy: { linear: 3.2, quadratic: 0.006 },
    strength: { linear: 1.45, quadratic: 0.0025 },
    agility: { linear: 0.65, quadratic: 0.0012 },
    intelligence: { linear: 0.3, quadratic: 0.0006 },
    armor: { linear: 0.8, quadratic: 0.0014 },
  },
  ARCHER: {
    maxHp: { linear: 9.2, quadratic: 0.018 },
    maxEnergy: { linear: 5.2, quadratic: 0.009 },
    strength: { linear: 0.75, quadratic: 0.0015 },
    agility: { linear: 1.5, quadratic: 0.0025 },
    intelligence: { linear: 0.55, quadratic: 0.001 },
    armor: { linear: 0.55, quadratic: 0.001 },
  },
};

export const MILESTONE_KEYS = ['VITALITY', 'MASTERY', 'FOCUS', 'MOBILITY', 'CONTROL'] as const;
export type MilestoneKey = (typeof MILESTONE_KEYS)[number];
export type MilestoneRanks = Partial<Record<MilestoneKey, number>>;

export interface MilestoneDefinition {
  key: MilestoneKey;
  name: string;
  description: string;
  maxRank: number;
  minimumAllocatedBeforeFirstRank: number;
}

export const MILESTONE_DEFINITIONS: readonly MilestoneDefinition[] = [
  {
    key: 'VITALITY',
    name: 'Vitality',
    description: 'Increases maximum health and armor.',
    maxRank: 5,
    minimumAllocatedBeforeFirstRank: 0,
  },
  {
    key: 'MASTERY',
    name: 'Class mastery',
    description: 'Increases the primary attribute of the class.',
    maxRank: 5,
    minimumAllocatedBeforeFirstRank: 0,
  },
  {
    key: 'FOCUS',
    name: 'Focus',
    description: 'Increases maximum energy and intelligence.',
    maxRank: 4,
    minimumAllocatedBeforeFirstRank: 0,
  },
  {
    key: 'MOBILITY',
    name: 'Mobility',
    description: 'Increases agility and maximum energy.',
    maxRank: 4,
    minimumAllocatedBeforeFirstRank: 0,
  },
  {
    key: 'CONTROL',
    name: 'Battle control',
    description: 'Improves the primary attribute, armor, and control rating.',
    maxRank: 2,
    minimumAllocatedBeforeFirstRank: 8,
  },
] as const;

export interface SoftCapDefinition {
  key: 'ATTRIBUTE' | 'ARMOR' | 'INITIATIVE' | 'CONTROL';
  firstThreshold: number;
  secondThreshold: number;
  middleRate: number;
  highRate: number;
}

export const SOFT_CAPS: readonly SoftCapDefinition[] = [
  { key: 'ATTRIBUTE', firstThreshold: 85, secondThreshold: 150, middleRate: 0.6, highRate: 0.3 },
  { key: 'ARMOR', firstThreshold: 70, secondThreshold: 130, middleRate: 0.55, highRate: 0.25 },
  { key: 'INITIATIVE', firstThreshold: 70, secondThreshold: 130, middleRate: 0.55, highRate: 0.25 },
  { key: 'CONTROL', firstThreshold: 70, secondThreshold: 140, middleRate: 0.5, highRate: 0.25 },
] as const;

export interface CanonicalCharacterStatsInput {
  characterClass: CharacterClass;
  level: number;
  milestoneRanks?: MilestoneRanks;
  equipment?: Partial<ProgressionStatVector>;
  permanent?: Partial<ProgressionStatVector>;
  temporary?: Partial<ProgressionStatVector>;
  legacyAdjustment?: Partial<ProgressionStatVector>;
}

export interface CharacterStatBreakdown {
  sources: {
    base: ProgressionStatVector;
    levels: ProgressionStatVector;
    milestones: ProgressionStatVector;
    equipment: ProgressionStatVector;
    permanent: ProgressionStatVector;
    temporary: ProgressionStatVector;
    legacyAdjustment: ProgressionStatVector;
  };
  rawTotal: ProgressionStatVector;
  effectiveBeforeLegacy: ProgressionStatVector;
  effective: ProgressionStatVector;
  derived: {
    primaryStat: 'strength' | 'agility' | 'intelligence';
    armorDamageReduction: number;
    initiative: number;
    dodgeChance: number;
    controlPower: number;
    controlResistance: number;
  };
}

export interface MilestoneValidationResult {
  valid: boolean;
  earnedPoints: number;
  spentPoints: number;
  error?: 'UNKNOWN_MILESTONE' | 'INVALID_RANK' | 'RANK_LIMIT' | 'POINT_LIMIT' | 'PREREQUISITE';
  milestoneKey?: string;
}

export function normalizeCharacterLevel(level: number): number {
  if (!Number.isFinite(level)) return 1;
  return Math.min(MAX_CHARACTER_LEVEL, Math.max(1, Math.floor(level)));
}

export function milestonePointsForLevel(level: number): number {
  return Math.floor(normalizeCharacterLevel(level) / MILESTONE_INTERVAL_LEVELS);
}

export function spentMilestonePoints(ranks: MilestoneRanks | undefined): number {
  return MILESTONE_DEFINITIONS.reduce((sum, definition) => {
    const value = ranks?.[definition.key] ?? 0;
    return sum + (Number.isInteger(value) && value > 0 ? value : 0);
  }, 0);
}

export function validateMilestoneRanks(level: number, ranks: MilestoneRanks): MilestoneValidationResult {
  const earnedPoints = milestonePointsForLevel(level);
  let spentPoints = 0;
  for (const [key, rawRank] of Object.entries(ranks)) {
    const definition = MILESTONE_DEFINITIONS.find((candidate) => candidate.key === key);
    if (!definition)
      return { valid: false, earnedPoints, spentPoints, error: 'UNKNOWN_MILESTONE', milestoneKey: key };
    if (!Number.isInteger(rawRank) || rawRank < 0)
      return { valid: false, earnedPoints, spentPoints, error: 'INVALID_RANK', milestoneKey: key };
    if (rawRank > definition.maxRank)
      return { valid: false, earnedPoints, spentPoints, error: 'RANK_LIMIT', milestoneKey: key };
    spentPoints += rawRank;
  }
  if (spentPoints > earnedPoints)
    return { valid: false, earnedPoints, spentPoints, error: 'POINT_LIMIT' };
  const controlRank = ranks.CONTROL ?? 0;
  const nonControlSpent = spentPoints - controlRank;
  const controlDefinition = MILESTONE_DEFINITIONS.find((definition) => definition.key === 'CONTROL')!;
  if (controlRank > 0 && nonControlSpent < controlDefinition.minimumAllocatedBeforeFirstRank) {
    return { valid: false, earnedPoints, spentPoints, error: 'PREREQUISITE', milestoneKey: 'CONTROL' };
  }
  return { valid: true, earnedPoints, spentPoints };
}

export function addMilestoneRank(
  level: number,
  ranks: MilestoneRanks,
  milestoneKey: MilestoneKey,
): MilestoneRanks {
  const next = { ...ranks, [milestoneKey]: (ranks[milestoneKey] ?? 0) + 1 };
  const validation = validateMilestoneRanks(level, next);
  if (!validation.valid) throw new Error(`MILESTONE_${validation.error ?? 'INVALID'}`);
  return next;
}

export function primaryStatForClass(
  characterClass: CharacterClass,
): 'strength' | 'agility' | 'intelligence' {
  switch (characterClass) {
    case 'WARRIOR':
      return 'strength';
    case 'ARCHER':
      return 'agility';
    case 'MAGE':
      return 'intelligence';
  }
}

export function calculateCharacterStats(input: CanonicalCharacterStatsInput): CharacterStatBreakdown {
  const level = normalizeCharacterLevel(input.level);
  const ranks = input.milestoneRanks ?? {};
  const validation = validateMilestoneRanks(level, ranks);
  if (!validation.valid) throw new Error(`MILESTONE_${validation.error ?? 'INVALID'}`);
  const sources = {
    base: cloneStats(BASE_CLASS_STATS[input.characterClass]),
    levels: levelGrowth(input.characterClass, level),
    milestones: milestoneStats(input.characterClass, ranks),
    equipment: normalizeStats(input.equipment),
    permanent: normalizeStats(input.permanent),
    temporary: normalizeStats(input.temporary),
    legacyAdjustment: normalizeStats(input.legacyAdjustment),
  };
  const rawTotal = sumStats(
    sources.base,
    sources.levels,
    sources.milestones,
    sources.equipment,
    sources.permanent,
    sources.temporary,
  );
  const effectiveBeforeLegacy = applyCanonicalSoftCaps(rawTotal);
  const effective = clampEffectiveStats(addStats(effectiveBeforeLegacy, sources.legacyAdjustment));
  const initiativeRating = applySoftCap(effective.agility, SOFT_CAPS[2]!);
  const controlPowerRating = applySoftCap(
    effective.intelligence + (ranks.CONTROL ?? 0) * 15,
    SOFT_CAPS[3]!,
  );
  const controlResistanceRating = applySoftCap(
    effective.strength * 0.35 + effective.armor * 0.65 + (ranks.VITALITY ?? 0) * 6,
    SOFT_CAPS[3]!,
  );
  const dodgeRating = Math.max(0, initiativeRating - 10);
  return {
    sources,
    rawTotal,
    effectiveBeforeLegacy,
    effective,
    derived: {
      primaryStat: primaryStatForClass(input.characterClass),
      armorDamageReduction: roundTo(1 - armorDamageMultiplier(effective.armor), 4),
      initiative: roundTo(10 + initiativeRating, 2),
      dodgeChance: roundTo(dodgeRating / (dodgeRating + 240), 4),
      controlPower: roundTo(controlPowerRating, 2),
      controlResistance: roundTo(controlResistanceRating, 2),
    },
  };
}

export function calculateLegacyAdjustment(
  legacyEffective: ProgressionStatVector,
  canonicalWithoutLegacy: ProgressionStatVector,
): ProgressionStatVector {
  return mapStats((key) => legacyEffective[key] - canonicalWithoutLegacy[key]);
}

export function preserveResourceRatio(
  current: number,
  previousMaximum: number,
  nextMaximum: number,
): number {
  const safeMaximum = Math.max(0, Math.round(nextMaximum));
  if (safeMaximum === 0) return 0;
  if (!Number.isFinite(previousMaximum) || previousMaximum <= 0) {
    return Math.min(safeMaximum, Math.max(0, Math.round(current)));
  }
  const ratio = Math.min(1, Math.max(0, current / previousMaximum));
  return Math.min(safeMaximum, Math.max(0, Math.round(safeMaximum * ratio)));
}

export function respecCostSilver(level: number, spentPoints: number, freeAvailable: boolean): number {
  if (freeAvailable) return 0;
  return 250 + normalizeCharacterLevel(level) * 40 + Math.max(0, Math.floor(spentPoints)) * 75;
}

export function applySoftCap(value: number, definition: SoftCapDefinition): number {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0);
  const first = Math.min(safe, definition.firstThreshold);
  const middle = Math.min(
    Math.max(0, safe - definition.firstThreshold),
    definition.secondThreshold - definition.firstThreshold,
  );
  const high = Math.max(0, safe - definition.secondThreshold);
  return first + middle * definition.middleRate + high * definition.highRate;
}

export function armorDamageMultiplier(armor: number): number {
  return 100 / (100 + Math.max(0, armor));
}

function levelGrowth(characterClass: CharacterClass, level: number): ProgressionStatVector {
  const levelsGained = normalizeCharacterLevel(level) - 1;
  const curve = CLASS_GROWTH_CURVES[characterClass];
  return mapStats((key) => {
    const coefficient = curve[key];
    return Math.round(coefficient.linear * levelsGained + coefficient.quadratic * levelsGained ** 2);
  });
}

function milestoneStats(
  characterClass: CharacterClass,
  ranks: MilestoneRanks,
): ProgressionStatVector {
  const result = cloneStats(ZERO_PROGRESSION_STATS);
  const primary = primaryStatForClass(characterClass);
  result.maxHp += (ranks.VITALITY ?? 0) * 35;
  result.armor += (ranks.VITALITY ?? 0) * 2;
  result[primary] += (ranks.MASTERY ?? 0) * 4;
  result.maxEnergy += (ranks.FOCUS ?? 0) * 22;
  result.intelligence += (ranks.FOCUS ?? 0) * 2;
  result.agility += (ranks.MOBILITY ?? 0) * 3;
  result.maxEnergy += (ranks.MOBILITY ?? 0) * 8;
  result[primary] += (ranks.CONTROL ?? 0) * 2;
  result.armor += (ranks.CONTROL ?? 0) * 2;
  return result;
}

function applyCanonicalSoftCaps(raw: ProgressionStatVector): ProgressionStatVector {
  return {
    maxHp: Math.max(1, Math.round(raw.maxHp)),
    maxEnergy: Math.max(0, Math.round(raw.maxEnergy)),
    strength: Math.round(applySoftCap(raw.strength, SOFT_CAPS[0]!)),
    agility: Math.round(applySoftCap(raw.agility, SOFT_CAPS[0]!)),
    intelligence: Math.round(applySoftCap(raw.intelligence, SOFT_CAPS[0]!)),
    armor: Math.round(applySoftCap(raw.armor, SOFT_CAPS[1]!)),
  };
}

function clampEffectiveStats(stats: ProgressionStatVector): ProgressionStatVector {
  return {
    maxHp: Math.max(1, Math.round(stats.maxHp)),
    maxEnergy: Math.max(0, Math.round(stats.maxEnergy)),
    strength: Math.max(0, Math.round(stats.strength)),
    agility: Math.max(0, Math.round(stats.agility)),
    intelligence: Math.max(0, Math.round(stats.intelligence)),
    armor: Math.max(0, Math.round(stats.armor)),
  };
}

function normalizeStats(stats: Partial<ProgressionStatVector> | undefined): ProgressionStatVector {
  return mapStats((key) => {
    const value = stats?.[key];
    return Number.isFinite(value) ? Math.round(value!) : 0;
  });
}

function sumStats(...vectors: readonly ProgressionStatVector[]): ProgressionStatVector {
  return mapStats((key) => vectors.reduce((sum, vector) => sum + vector[key], 0));
}

function addStats(first: ProgressionStatVector, second: ProgressionStatVector): ProgressionStatVector {
  return mapStats((key) => first[key] + second[key]);
}

function cloneStats(stats: Readonly<ProgressionStatVector>): ProgressionStatVector {
  return { ...stats };
}

function mapStats(mapper: (key: ProgressionStatKey) => number): ProgressionStatVector {
  return Object.fromEntries(PROGRESSION_STAT_KEYS.map((key) => [key, mapper(key)])) as ProgressionStatVector;
}

function roundTo(value: number, precision: number): number {
  const scale = 10 ** precision;
  return Math.round(value * scale) / scale;
}
