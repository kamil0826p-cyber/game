import { describe, expect, it } from 'vitest';
import type { CharacterClass } from '../src/common/domain/game.types.js';
import {
  addMilestoneRank,
  calculateCharacterStats,
  calculateLegacyAdjustment,
  milestonePointsForLevel,
  preserveResourceRatio,
  respecCostSilver,
  validateMilestoneRanks,
  ZERO_PROGRESSION_STATS,
  type MilestoneRanks,
  type ProgressionStatVector,
} from '../src/modules/characters/progression/character-progression.rules.js';

const classes: readonly CharacterClass[] = ['MAGE', 'WARRIOR', 'ARCHER'];

const snapshots: Readonly<
  Record<number, Record<CharacterClass, ProgressionStatVector>>
> = {
  1: {
    MAGE: { maxHp: 75, maxEnergy: 120, strength: 4, agility: 7, intelligence: 14, armor: 2 },
    WARRIOR: { maxHp: 130, maxEnergy: 70, strength: 14, agility: 7, intelligence: 3, armor: 8 },
    ARCHER: { maxHp: 95, maxEnergy: 95, strength: 7, agility: 14, intelligence: 5, armor: 4 },
  },
  10: {
    MAGE: { maxHp: 143, maxEnergy: 191, strength: 7, agility: 14, intelligence: 28, armor: 5 },
    WARRIOR: { maxHp: 235, maxEnergy: 99, strength: 27, agility: 13, intelligence: 6, armor: 15 },
    ARCHER: { maxHp: 179, maxEnergy: 143, strength: 14, agility: 28, intelligence: 10, armor: 9 },
  },
  25: {
    MAGE: { maxHp: 261, maxEnergy: 314, strength: 13, agility: 26, intelligence: 53, armor: 11 },
    WARRIOR: { maxHp: 419, maxEnergy: 150, strength: 50, agility: 23, intelligence: 11, armor: 28 },
    ARCHER: { maxHp: 326, maxEnergy: 225, strength: 26, agility: 51, intelligence: 19, armor: 18 },
  },
  50: {
    MAGE: { maxHp: 471, maxEnergy: 531, strength: 23, agility: 47, intelligence: 92, armor: 21 },
    WARRIOR: { maxHp: 746, maxEnergy: 241, strength: 89, agility: 42, intelligence: 19, armor: 51 },
    ARCHER: { maxHp: 589, maxEnergy: 371, strength: 47, agility: 90, intelligence: 34, armor: 33 },
  },
  75: {
    MAGE: { maxHp: 699, maxEnergy: 763, strength: 34, agility: 70, intelligence: 120, armor: 31 },
    WARRIOR: { maxHp: 1101, maxEnergy: 340, strength: 115, agility: 62, intelligence: 28, armor: 73 },
    ARCHER: { maxHp: 874, maxEnergy: 529, strength: 71, agility: 117, intelligence: 51, armor: 50 },
  },
  100: {
    MAGE: { maxHp: 945, maxEnergy: 1010, strength: 46, agility: 90, intelligence: 138, armor: 43 },
    WARRIOR: { maxHp: 1484, maxEnergy: 446, strength: 134, agility: 83, intelligence: 39, armor: 87 },
    ARCHER: { maxHp: 1182, maxEnergy: 698, strength: 92, agility: 135, intelligence: 69, armor: 68 },
  },
};

describe('canonical character progression rules', () => {
  it.each(Object.entries(snapshots))(
    'keeps the approved class curve snapshot at level %s',
    (levelText, expectedByClass) => {
      const level = Number(levelText);
      for (const characterClass of classes) {
        expect(calculateCharacterStats({ characterClass, level }).effective).toEqual(
          expectedByClass[characterClass],
        );
      }
    },
  );

  it('awards one milestone point every five levels and caps the total at twenty', () => {
    expect(milestonePointsForLevel(1)).toBe(0);
    expect(milestonePointsForLevel(4)).toBe(0);
    expect(milestonePointsForLevel(5)).toBe(1);
    expect(milestonePointsForLevel(99)).toBe(19);
    expect(milestonePointsForLevel(100)).toBe(20);
    expect(milestonePointsForLevel(999)).toBe(20);
  });

  it('enforces rank, point, and prerequisite limits for milestones', () => {
    expect(validateMilestoneRanks(5, { VITALITY: 1 })).toMatchObject({ valid: true });
    expect(validateMilestoneRanks(5, { VITALITY: 2 })).toMatchObject({
      valid: false,
      error: 'POINT_LIMIT',
    });
    expect(validateMilestoneRanks(100, { VITALITY: 6 })).toMatchObject({
      valid: false,
      error: 'RANK_LIMIT',
    });
    expect(validateMilestoneRanks(50, { CONTROL: 1 })).toMatchObject({
      valid: false,
      error: 'PREREQUISITE',
    });
    expect(
      validateMilestoneRanks(50, { VITALITY: 4, MASTERY: 4, CONTROL: 1 }),
    ).toMatchObject({ valid: true, spentPoints: 9 });
  });

  it('produces the same result when the same milestone allocation is recalculated', () => {
    const ranks: MilestoneRanks = { VITALITY: 2, MASTERY: 2, FOCUS: 1 };
    const first = calculateCharacterStats({ characterClass: 'MAGE', level: 25, milestoneRanks: ranks });
    const second = calculateCharacterStats({ characterClass: 'MAGE', level: 25, milestoneRanks: ranks });
    expect(second).toEqual(first);
  });

  it('adds exactly one rank for a valid milestone allocation', () => {
    expect(addMilestoneRank(10, { VITALITY: 1 }, 'MASTERY')).toEqual({
      VITALITY: 1,
      MASTERY: 1,
    });
  });

  it('keeps equipment recomputation idempotent instead of stacking bonuses', () => {
    const equipment = { ...ZERO_PROGRESSION_STATS, strength: 7, maxHp: 45 };
    const first = calculateCharacterStats({ characterClass: 'WARRIOR', level: 25, equipment });
    const second = calculateCharacterStats({ characterClass: 'WARRIOR', level: 25, equipment });
    expect(second.effective).toEqual(first.effective);
    expect(second.sources.equipment).toEqual(equipment);
  });

  it('derives a legacy adjustment that preserves all effective stats exactly', () => {
    const canonical = calculateCharacterStats({ characterClass: 'ARCHER', level: 50 });
    const legacy: ProgressionStatVector = {
      maxHp: canonical.effective.maxHp + 17,
      maxEnergy: canonical.effective.maxEnergy - 9,
      strength: canonical.effective.strength + 2,
      agility: canonical.effective.agility + 11,
      intelligence: canonical.effective.intelligence - 1,
      armor: canonical.effective.armor + 6,
    };
    const legacyAdjustment = calculateLegacyAdjustment(legacy, canonical.effective);
    expect(
      calculateCharacterStats({
        characterClass: 'ARCHER',
        level: 50,
        legacyAdjustment,
      }).effective,
    ).toEqual(legacy);
  });

  it('preserves the HP and energy ratio when maximum resources change', () => {
    expect(preserveResourceRatio(50, 100, 250)).toBe(125);
    expect(preserveResourceRatio(99, 100, 1)).toBe(1);
    expect(preserveResourceRatio(1000, 100, 250)).toBe(250);
    expect(preserveResourceRatio(12, 0, 10)).toBe(10);
  });

  it('makes the first post-migration respec free and versions the paid cost formula', () => {
    expect(respecCostSilver(75, 12, true)).toBe(0);
    expect(respecCostSilver(75, 12, false)).toBe(4_150);
    expect(respecCostSilver(1, 0, false)).toBe(290);
  });
});
