import {
  calculateSkillPointBudget,
  PROGRESSION_RULESETS,
} from '../characters/progression.rules.js';
import type { SkillCatalogDefinition, SkillPointSummary, SkillUnlockState } from './skill.types.js';

export const SKILL_POINT_LEVEL_INTERVAL = PROGRESSION_RULESETS.v1!.skillPointLevelInterval;

export const calculateSkillPoints = (
  level: number,
  spent: number,
  capacity = Number.MAX_SAFE_INTEGER,
): SkillPointSummary =>
  calculateSkillPointBudget(level, spent, capacity, PROGRESSION_RULESETS.v1!);

export const skillPointsGainedBetweenLevels = (
  previousLevel: number,
  nextLevel: number,
  capacity = Number.MAX_SAFE_INTEGER,
): number =>
  Math.max(
    0,
    calculateSkillPoints(nextLevel, 0, capacity).earned -
      calculateSkillPoints(previousLevel, 0, capacity).earned,
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
