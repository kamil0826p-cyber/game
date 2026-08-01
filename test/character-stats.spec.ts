import { describe, expect, it } from 'vitest';
import {
  addStatVectors,
  calculateCharacterStats,
  progressionPointsForLevel,
} from '../src/modules/progression/character-stats.js';

const equipment = { maxHp: 40, maxEnergy: 12, strength: 3, agility: 2, intelligence: 1, armor: 4 };

describe('canonical character stats', () => {
  it('uses class-specific automatic growth instead of uniform +2 gains', () => {
    const warrior = calculateCharacterStats({ characterClass: 'WARRIOR', level: 30 });
    const mage = calculateCharacterStats({ characterClass: 'MAGE', level: 30 });
    const archer = calculateCharacterStats({ characterClass: 'ARCHER', level: 30 });
    expect(warrior.sources.automaticProgression.strength).toBeGreaterThan(mage.sources.automaticProgression.strength);
    expect(mage.sources.automaticProgression.intelligence).toBeGreaterThan(archer.sources.automaticProgression.intelligence);
    expect(archer.sources.automaticProgression.agility).toBeGreaterThan(warrior.sources.automaticProgression.agility);
  });

  it('makes equipment application reversible without drift', () => {
    const base = calculateCharacterStats({ characterClass: 'ARCHER', level: 25, choices: ['PRECISION', 'MOBILITY'] });
    const equipped = calculateCharacterStats({
      characterClass: 'ARCHER',
      level: 25,
      choices: ['PRECISION', 'MOBILITY'],
      equipment,
    });
    const unequipped = calculateCharacterStats({ characterClass: 'ARCHER', level: 25, choices: ['PRECISION', 'MOBILITY'] });
    expect(equipped.effective).toEqual(addStatVectors(base.effective, equipment));
    expect(unequipped).toEqual(base);
  });

  it('allows different viable profiles for the same class and level', () => {
    const endurance = calculateCharacterStats({
      characterClass: 'WARRIOR',
      level: 50,
      choices: Array.from({ length: progressionPointsForLevel(50) }, () => 'ENDURANCE'),
    });
    const precision = calculateCharacterStats({
      characterClass: 'WARRIOR',
      level: 50,
      choices: Array.from({ length: progressionPointsForLevel(50) }, () => 'PRECISION'),
    });
    expect(endurance.effective.maxHp).toBeGreaterThan(precision.effective.maxHp);
    expect(precision.effective.agility).toBeGreaterThan(endurance.effective.agility);
    expect(endurance.points.spent).toBe(precision.points.spent);
  });

  it('explains the effective value as the exact sum of all sources', () => {
    const snapshot = calculateCharacterStats({
      characterClass: 'MAGE',
      level: 40,
      choices: ['RITUAL_KNOWLEDGE', 'CONTROL'],
      legacyAdjustment: { maxHp: 7, intelligence: -1 },
      equipment,
      temporary: { armor: 3 },
    });
    expect(snapshot.effective).toEqual(addStatVectors(
      snapshot.sources.base,
      snapshot.sources.automaticProgression,
      snapshot.sources.milestoneChoices,
      snapshot.sources.legacyAdjustment,
      snapshot.sources.equipment,
      snapshot.sources.temporary,
    ));
  });

  it('applies documented diminishing returns to derived power and armor', () => {
    const snapshot = calculateCharacterStats({
      characterClass: 'WARRIOR',
      level: 100,
      legacyAdjustment: { strength: 500, armor: 500 },
    });
    expect(snapshot.derived.physicalPower).toBeLessThanOrEqual(snapshot.limits.primaryHardCap);
    expect(snapshot.derived.damageReductionBasisPoints).toBeLessThanOrEqual(7_500);
  });
});
