import { describe, expect, it } from 'vitest';
import { physicalDamageMultiplier } from '../src/modules/combat/combat.rules.js';
import {
  PROGRESSION_NODES,
  addStatVectors,
  applyArmorDiminishingReturns,
  applyPrimaryDiminishingReturns,
  calculateCharacterStats,
  progressionPointsForLevel,
  subtractStatVectors,
} from '../src/modules/progression/character-stats.js';

const equipment = { maxHp: 40, maxEnergy: 12, strength: 3, agility: 2, intelligence: 1, armor: 4 };

describe('canonical character stats', () => {
  it('preserves distinct class identities at every required curve checkpoint', () => {
    for (const level of [1, 10, 25, 50, 75, 100]) {
      const warrior = calculateCharacterStats({ characterClass: 'WARRIOR', level });
      const mage = calculateCharacterStats({ characterClass: 'MAGE', level });
      const archer = calculateCharacterStats({ characterClass: 'ARCHER', level });

      expect(warrior.effective.maxHp, `warrior HP at level ${level}`).toBeGreaterThan(archer.effective.maxHp);
      expect(archer.effective.maxHp, `archer HP at level ${level}`).toBeGreaterThan(mage.effective.maxHp);
      expect(mage.effective.maxEnergy, `mage energy at level ${level}`).toBeGreaterThan(archer.effective.maxEnergy);
      expect(archer.effective.maxEnergy, `archer energy at level ${level}`).toBeGreaterThan(warrior.effective.maxEnergy);
      expect(warrior.effective.strength, `warrior strength at level ${level}`).toBeGreaterThan(archer.effective.strength);
      expect(mage.effective.intelligence, `mage intelligence at level ${level}`).toBeGreaterThan(archer.effective.intelligence);
      expect(archer.effective.agility, `archer agility at level ${level}`).toBeGreaterThan(warrior.effective.agility);
    }
  });

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

  it('exposes versioned node effects and rank limits in the authoritative snapshot', () => {
    const snapshot = calculateCharacterStats({ characterClass: 'MAGE', level: 25 });
    expect(snapshot.nodes).toEqual(PROGRESSION_NODES);
    expect(snapshot.nodes.RITUAL_KNOWLEDGE.bonusesPerRank).toEqual({
      maxHp: 0,
      maxEnergy: 16,
      strength: 0,
      agility: 0,
      intelligence: 2,
      armor: 0,
    });
    expect(snapshot.nodes.RITUAL_KNOWLEDGE.maxRank).toBe(8);
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

  it('preserves an existing effective build exactly through the legacy migration adjustment', () => {
    const oldEffective = {
      maxHp: 777,
      maxEnergy: 333,
      strength: 91,
      agility: 67,
      intelligence: 24,
      armor: 58,
    };
    const canonical = calculateCharacterStats({ characterClass: 'WARRIOR', level: 42, equipment });
    const legacyAdjustment = subtractStatVectors(
      oldEffective,
      canonical.sources.base,
      canonical.sources.automaticProgression,
      canonical.sources.milestoneChoices,
      canonical.sources.equipment,
      canonical.sources.temporary,
    );
    const migrated = calculateCharacterStats({
      characterClass: 'WARRIOR',
      level: 42,
      equipment,
      legacyAdjustment,
    });
    expect(migrated.effective).toEqual(oldEffective);
  });

  it('uses the same hard caps for UI derivation and production armor mitigation', () => {
    expect(applyPrimaryDiminishingReturns(1_000)).toBe(140);
    expect(applyArmorDiminishingReturns(1_000)).toBe(100);
    expect(physicalDamageMultiplier(1_000)).toBe(physicalDamageMultiplier(160));
    const snapshot = calculateCharacterStats({
      characterClass: 'WARRIOR',
      level: 100,
      legacyAdjustment: { strength: 500, armor: 500 },
    });
    expect(snapshot.derived.physicalPower).toBeLessThanOrEqual(snapshot.limits.primaryHardCap);
    expect(snapshot.derived.damageReductionBasisPoints).toBeLessThanOrEqual(7_500);
  });
});
