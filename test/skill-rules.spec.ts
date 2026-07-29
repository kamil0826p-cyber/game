import { describe, expect, it } from 'vitest';
import { skillsForClass } from '../src/modules/skills/skill.catalog.js';
import {
  calculateSkillPoints,
  getSkillEligibility,
  skillPointsGainedBetweenLevels,
} from '../src/modules/skills/skill.rules.js';

const warriorSkills = skillsForClass('WARRIOR');
const root = warriorSkills[0]!;
const firstBranch = warriorSkills[1]!;

describe('skill progression rules', () => {
  it('awards the first point at level 10 and one more every 10 levels', () => {
    expect(calculateSkillPoints(1, 0)).toEqual({
      earned: 0,
      spent: 0,
      available: 0,
      nextPointAtLevel: 10,
    });
    expect(calculateSkillPoints(9, 0).earned).toBe(0);
    expect(calculateSkillPoints(10, 0).earned).toBe(1);
    expect(calculateSkillPoints(29, 1)).toMatchObject({ earned: 2, spent: 1, available: 1 });
    expect(calculateSkillPoints(80, 8)).toMatchObject({ earned: 8, spent: 8, available: 0 });
  });

  it('counts every skill point threshold crossed by a multi-level reward', () => {
    expect(skillPointsGainedBetweenLevels(1, 26)).toBe(2);
    expect(skillPointsGainedBetweenLevels(9, 10)).toBe(1);
    expect(skillPointsGainedBetweenLevels(19, 30)).toBe(2);
    expect(skillPointsGainedBetweenLevels(30, 29)).toBe(0);
  });

  it('never exposes a negative available balance for inconsistent legacy data', () => {
    expect(calculateSkillPoints(1, 5).available).toBe(0);
  });

  it('requires level, prerequisites, and a point before a skill is available', () => {
    expect(getSkillEligibility(root, 9, new Set(), 1).unlockState).toBe('LOCKED_LEVEL');
    expect(getSkillEligibility(root, 10, new Set(), 0).unlockState).toBe('LOCKED_POINTS');
    expect(getSkillEligibility(root, 10, new Set(), 1).unlockState).toBe('AVAILABLE');

    expect(getSkillEligibility(firstBranch, 20, new Set(), 1)).toEqual({
      unlockState: 'LOCKED_PREREQUISITE',
      missingPrerequisiteKeys: [root.key],
    });
    expect(getSkillEligibility(firstBranch, 20, new Set([root.key]), 1).unlockState).toBe(
      'AVAILABLE',
    );
  });

  it('treats an unlocked skill as unlocked regardless of remaining points', () => {
    expect(getSkillEligibility(root, 10, new Set([root.key]), 0)).toEqual({
      unlockState: 'UNLOCKED',
      missingPrerequisiteKeys: [],
    });
  });
});
