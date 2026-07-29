import type { SkillCatalogDefinition, SkillPointSummary, SkillUnlockState } from './skill.types.js';

export const SKILL_POINT_LEVEL_INTERVAL = 10;

export const calculateSkillPoints = (level: number, spent: number): SkillPointSummary => {
  const safeLevel = Math.max(1, Math.trunc(level));
  const safeSpent = Math.max(0, Math.trunc(spent));
  const earned = Math.floor(safeLevel / SKILL_POINT_LEVEL_INTERVAL);
  const nextPointAtLevel =
    (Math.floor(safeLevel / SKILL_POINT_LEVEL_INTERVAL) + 1) * SKILL_POINT_LEVEL_INTERVAL;

  return {
    earned,
    spent: safeSpent,
    available: Math.max(0, earned - safeSpent),
    nextPointAtLevel,
  };
};

export const skillPointsGainedBetweenLevels = (
  previousLevel: number,
  nextLevel: number,
): number =>
  Math.max(
    0,
    calculateSkillPoints(nextLevel, 0).earned - calculateSkillPoints(previousLevel, 0).earned,
  );

export interface SkillEligibility {
  unlockState: SkillUnlockState;
  missingPrerequisiteKeys: string[];
}

export const getSkillEligibility = (
  skill: SkillCatalogDefinition,
  characterLevel: number,
  unlockedSkillKeys: ReadonlySet<string>,
  availablePoints: number,
): SkillEligibility => {
  if (unlockedSkillKeys.has(skill.key)) {
    return { unlockState: 'UNLOCKED', missingPrerequisiteKeys: [] };
  }

  const missingPrerequisiteKeys = skill.prerequisiteKeys.filter(
    (key) => !unlockedSkillKeys.has(key),
  );

  if (characterLevel < skill.minimumLevel) {
    return { unlockState: 'LOCKED_LEVEL', missingPrerequisiteKeys };
  }
  if (missingPrerequisiteKeys.length > 0) {
    return { unlockState: 'LOCKED_PREREQUISITE', missingPrerequisiteKeys };
  }
  if (availablePoints < 1) {
    return { unlockState: 'LOCKED_POINTS', missingPrerequisiteKeys: [] };
  }
  return { unlockState: 'AVAILABLE', missingPrerequisiteKeys: [] };
};
