import { describe, expect, it } from 'vitest';
import { MOB_RANK_MULTIPLIERS, MOB_RANKS } from '../src/modules/mobs/mob.catalog.js';

describe('mob ranks', () => {
  it('defines all five progression ranks in increasing strength order', () => {
    expect(MOB_RANKS).toEqual(['SPAWN', 'EXECUTIONER', 'ARCH_EXECUTIONER', 'REAPER', 'ANCIENT']);
    expect(MOB_RANKS.map((rank) => MOB_RANK_MULTIPLIERS[rank])).toEqual([1, 1.75, 3, 5, 8]);
  });
});
