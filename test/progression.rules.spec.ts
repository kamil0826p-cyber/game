import { describe, expect, it } from 'vitest';
import {
  applyExperience,
  calculateBaseStats,
  calculateSkillPointBudget,
  experienceRequiredForNextLevel,
  PROGRESSION_RULESETS,
} from '../src/modules/characters/progression.rules.js';

const ruleset = PROGRESSION_RULESETS.v1!;

describe('progression rules', () => {
  it('uses distinct deterministic class curves', () => {
    const mage = calculateBaseStats('MAGE', 20, ruleset);
    const warrior = calculateBaseStats('WARRIOR', 20, ruleset);
    const archer = calculateBaseStats('ARCHER', 20, ruleset);

    expect(calculateBaseStats('MAGE', 20, ruleset)).toEqual(mage);
    expect(warrior.maxHp).toBeGreaterThan(archer.maxHp);
    expect(archer.agility).toBeGreaterThan(warrior.agility);
    expect(mage.intelligence).toBeGreaterThan(archer.intelligence);
  });

  it('applies multiple level gains without crossing the configured cap', () => {
    const result = applyExperience(1, 0, 1_000_000, 5, ruleset);
    expect(result.level).toBe(5);
    expect(result.reachedCap).toBe(true);
    expect(result.experience).toBe(0);
    expect(result.appliedExperience).toBeGreaterThan(0);
    expect(result.appliedExperience + result.discardedExperience).toBe(1_000_000);
  });

  it('reports only the newly awarded XP used to reach the cap', () => {
    const needed = experienceRequiredForNextLevel(4, ruleset);
    const result = applyExperience(4, needed - 10, 100, 5, ruleset);
    expect(result).toMatchObject({
      level: 5,
      experience: 0,
      levelsGained: 1,
      appliedExperience: 10,
      discardedExperience: 90,
      reachedCap: true,
    });
  });

  it('does not accumulate experience while already capped', () => {
    const result = applyExperience(30, 999, 500, 30, ruleset);
    expect(result).toMatchObject({
      level: 30,
      experience: 0,
      levelsGained: 0,
      appliedExperience: 0,
      discardedExperience: 500,
      reachedCap: true,
    });
  });

  it('normalizes legacy overflow before applying a new award', () => {
    const firstRequirement = experienceRequiredForNextLevel(1, ruleset);
    const result = applyExperience(1, firstRequirement + 25, 50, 10, ruleset);
    expect(result.level).toBe(2);
    expect(result.experience).toBe(75);
    expect(result.appliedExperience).toBe(50);
    expect(result.discardedExperience).toBe(0);
  });

  it('never awards more skill points than the build can spend', () => {
    const budget = calculateSkillPointBudget(1000, 7, 8, ruleset);
    expect(budget).toEqual({ earned: 8, spent: 7, available: 1 });
  });

  it('clamps invalid levels and spent points safely', () => {
    expect(calculateBaseStats('WARRIOR', -5, ruleset)).toEqual(
      calculateBaseStats('WARRIOR', 1, ruleset),
    );
    expect(calculateSkillPointBudget(100, 99, 3, ruleset)).toEqual({
      earned: 3,
      spent: 3,
      available: 0,
    });
  });
});
