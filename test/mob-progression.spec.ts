import { describe, expect, it } from 'vitest';
import { applyExperience, experienceRequiredForLevel } from '../src/modules/mobs/character-progression.js';
import { rollMobLoot } from '../src/modules/mobs/mob-rewards.js';

describe('character progression', () => {
  it('carries overflow experience through multiple levels', () => {
    const gained = experienceRequiredForLevel(1) + experienceRequiredForLevel(2) + 10;
    expect(applyExperience(1, 0, gained)).toEqual({
      level: 3,
      experience: 10,
      levelsGained: 2,
      nextLevelExperience: experienceRequiredForLevel(3),
    });
  });

  it('never exceeds the level cap', () => {
    expect(applyExperience(100, 500, 10000)).toEqual({
      level: 100,
      experience: 0,
      levelsGained: 0,
      nextLevelExperience: null,
    });
  });
});

describe('mob loot', () => {
  it('supports deterministic reward rolls', () => {
    const values = [0.1, 0.9, 0.8];
    const result = rollMobLoot(
      [
        { itemKey: 'fur', chance: 0.5, minQuantity: 1, maxQuantity: 2 },
        { itemKey: 'rare', chance: 0.2, minQuantity: 1, maxQuantity: 1 },
      ],
      () => values.shift() ?? 1,
    );
    expect(result).toEqual([{ itemKey: 'fur', quantity: 2 }]);
  });
});
