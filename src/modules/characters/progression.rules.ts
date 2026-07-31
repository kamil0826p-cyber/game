import type { CharacterClass, CharacterStats } from '../../common/domain/game.types.js';

export interface ProgressionStats {
  maxHp: number;
  maxEnergy: number;
  strength: number;
  agility: number;
  intelligence: number;
  armor: number;
}

export interface StatGrowthCurve {
  base: ProgressionStats;
  perLevel: ProgressionStats;
}

export interface ProgressionRuleset {
  version: string;
  curves: Readonly<Record<CharacterClass, StatGrowthCurve>>;
  experienceBase: number;
  experienceLinearGrowth: number;
  experienceQuadraticGrowth: number;
  skillPointLevelInterval: number;
}

export interface ExperienceApplicationResult {
  previousLevel: number;
  level: number;
  experience: number;
  levelsGained: number;
  discardedExperience: number;
  reachedCap: boolean;
}

export const PROGRESSION_RULESETS: Readonly<Record<string, ProgressionRuleset>> = {
  v1: {
    version: 'v1',
    curves: {
      MAGE: {
        base: { maxHp: 75, maxEnergy: 120, strength: 4, agility: 7, intelligence: 14, armor: 2 },
        perLevel: { maxHp: 6, maxEnergy: 4, strength: 0.5, agility: 0.75, intelligence: 2.5, armor: 0.25 },
      },
      WARRIOR: {
        base: { maxHp: 130, maxEnergy: 70, strength: 14, agility: 7, intelligence: 3, armor: 8 },
        perLevel: { maxHp: 11, maxEnergy: 2, strength: 2.5, agility: 0.75, intelligence: 0.25, armor: 1.25 },
      },
      ARCHER: {
        base: { maxHp: 95, maxEnergy: 95, strength: 7, agility: 14, intelligence: 5, armor: 4 },
        perLevel: { maxHp: 8, maxEnergy: 3, strength: 1, agility: 2.5, intelligence: 0.5, armor: 0.5 },
      },
    },
    experienceBase: 100,
    experienceLinearGrowth: 55,
    experienceQuadraticGrowth: 5,
    skillPointLevelInterval: 10,
  },
};

const integerStat = (value: number): number => Math.max(0, Math.round(value));

export const requireProgressionRuleset = (version: string): ProgressionRuleset => {
  const ruleset = PROGRESSION_RULESETS[version];
  if (!ruleset) throw new Error(`Unknown progression ruleset ${version}.`);
  return ruleset;
};

export const calculateBaseStats = (
  characterClass: CharacterClass,
  level: number,
  ruleset: ProgressionRuleset,
): ProgressionStats => {
  const safeLevel = Math.max(1, Math.trunc(level));
  const curve = ruleset.curves[characterClass];
  const multiplier = safeLevel - 1;
  return {
    maxHp: integerStat(curve.base.maxHp + curve.perLevel.maxHp * multiplier),
    maxEnergy: integerStat(curve.base.maxEnergy + curve.perLevel.maxEnergy * multiplier),
    strength: integerStat(curve.base.strength + curve.perLevel.strength * multiplier),
    agility: integerStat(curve.base.agility + curve.perLevel.agility * multiplier),
    intelligence: integerStat(curve.base.intelligence + curve.perLevel.intelligence * multiplier),
    armor: integerStat(curve.base.armor + curve.perLevel.armor * multiplier),
  };
};

export const mergeStats = (
  base: ProgressionStats,
  bonuses: Partial<ProgressionStats>,
  current?: Pick<CharacterStats, 'hp' | 'energy'>,
): CharacterStats => {
  const maxHp = Math.max(1, base.maxHp + (bonuses.maxHp ?? 0));
  const maxEnergy = Math.max(0, base.maxEnergy + (bonuses.maxEnergy ?? 0));
  return {
    hp: Math.min(maxHp, Math.max(0, current?.hp ?? maxHp)),
    maxHp,
    energy: Math.min(maxEnergy, Math.max(0, current?.energy ?? maxEnergy)),
    maxEnergy,
    strength: Math.max(0, base.strength + (bonuses.strength ?? 0)),
    agility: Math.max(0, base.agility + (bonuses.agility ?? 0)),
    intelligence: Math.max(0, base.intelligence + (bonuses.intelligence ?? 0)),
    armor: Math.max(0, base.armor + (bonuses.armor ?? 0)),
  };
};

export const experienceRequiredForNextLevel = (
  level: number,
  ruleset: ProgressionRuleset,
): number => {
  const safeLevel = Math.max(1, Math.trunc(level));
  const offset = safeLevel - 1;
  return Math.max(
    1,
    Math.round(
      ruleset.experienceBase +
        ruleset.experienceLinearGrowth * offset +
        ruleset.experienceQuadraticGrowth * offset * offset,
    ),
  );
};

export const applyExperience = (
  currentLevel: number,
  currentExperience: number,
  awardedExperience: number,
  maximumLevel: number,
  ruleset: ProgressionRuleset,
): ExperienceApplicationResult => {
  const cap = Math.max(1, Math.trunc(maximumLevel));
  const previousLevel = Math.min(cap, Math.max(1, Math.trunc(currentLevel)));
  let level = previousLevel;
  let experience = Math.max(0, Math.trunc(currentExperience));
  let remainingAward = Math.max(0, Math.trunc(awardedExperience));

  if (level >= cap) {
    return {
      previousLevel,
      level,
      experience: 0,
      levelsGained: 0,
      discardedExperience: remainingAward,
      reachedCap: true,
    };
  }

  experience += remainingAward;
  remainingAward = 0;
  while (level < cap) {
    const required = experienceRequiredForNextLevel(level, ruleset);
    if (experience < required) break;
    experience -= required;
    level += 1;
  }

  let discardedExperience = 0;
  if (level >= cap) {
    discardedExperience = experience;
    experience = 0;
  }

  return {
    previousLevel,
    level,
    experience,
    levelsGained: level - previousLevel,
    discardedExperience,
    reachedCap: level >= cap,
  };
};

export const calculateSkillPointBudget = (
  level: number,
  spent: number,
  capacity: number,
  ruleset: ProgressionRuleset,
): { earned: number; spent: number; available: number; nextPointAtLevel?: number } => {
  const safeLevel = Math.max(1, Math.trunc(level));
  const safeCapacity = Math.max(0, Math.trunc(capacity));
  const safeSpent = Math.max(0, Math.min(safeCapacity, Math.trunc(spent)));
  const rawEarned = Math.floor(safeLevel / ruleset.skillPointLevelInterval);
  const earned = Math.min(rawEarned, safeCapacity);
  const nextPointAtLevel =
    earned >= safeCapacity
      ? undefined
      : (rawEarned + 1) * ruleset.skillPointLevelInterval;
  return {
    earned,
    spent: safeSpent,
    available: Math.max(0, earned - safeSpent),
    ...(nextPointAtLevel === undefined ? {} : { nextPointAtLevel }),
  };
};
