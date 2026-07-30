import { describe, expect, it } from 'vitest';
import {
  canReceiveMobExperience,
  splitMobExperience,
} from '../src/modules/mobs/mob-reward.rules.js';

describe('mob experience level-gap rules', () => {
  it('allows a difference of exactly ten levels and rejects eleven', () => {
    expect(canReceiveMobExperience(11, 1)).toBe(true);
    expect(canReceiveMobExperience(12, 1)).toBe(false);
    expect(canReceiveMobExperience(1, 11)).toBe(true);
    expect(canReceiveMobExperience(1, 12)).toBe(false);
  });

  it('gives no experience to a level 100 player fighting a level 1 mob', () => {
    expect(splitMobExperience(101, [100], 1)).toEqual([0]);
  });

  it('divides experience only between eligible party members', () => {
    expect(splitMobExperience(101, [1, 8, 100], 1)).toEqual([51, 50, 0]);
  });

  it('returns zero shares when nobody is in the allowed range', () => {
    expect(splitMobExperience(100, [50, 100], 1)).toEqual([0, 0]);
  });
});
