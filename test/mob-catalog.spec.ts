import { describe, expect, it } from 'vitest';
import { MOB_CATALOG, MOB_RANK_MULTIPLIERS, MOB_RANKS } from '../src/modules/mobs/mob.catalog.js';

describe('mob catalog', () => {
  it('defines all five progression ranks in increasing strength order', () => {
    expect(MOB_RANKS).toEqual(['SPAWN', 'EXECUTIONER', 'ARCH_EXECUTIONER', 'REAPER', 'ANCIENT']);
    expect(MOB_RANKS.map((rank) => MOB_RANK_MULTIPLIERS[rank])).toEqual([1, 1.75, 3, 5, 8]);
  });

  it('places between five and ten instances of every initial mob type', () => {
    for (const mob of MOB_CATALOG) {
      expect(mob.spawnPoints.length).toBeGreaterThanOrEqual(5);
      expect(mob.spawnPoints.length).toBeLessThanOrEqual(10);
      expect(new Set(mob.spawnPoints.map(({ x, y }) => `${x},${y}`)).size).toBe(mob.spawnPoints.length);
    }
  });

  it('keeps the executioner scorpion materially stronger than the spawn rabbit', () => {
    const rabbit = MOB_CATALOG.find((mob) => mob.key === 'spawn-rabbit')!;
    const scorpion = MOB_CATALOG.find((mob) => mob.key === 'executioner-scorpion')!;
    expect(scorpion.level).toBeGreaterThan(rabbit.level);
    expect(scorpion.stats.maxHp).toBeGreaterThan(rabbit.stats.maxHp * 3);
    expect(scorpion.stats.strength).toBeGreaterThan(rabbit.stats.strength * 2);
    expect(scorpion.experience).toBeGreaterThan(rabbit.experience);
    expect(rabbit.loot.map((entry) => entry.itemKey)).not.toEqual(
      scorpion.loot.map((entry) => entry.itemKey),
    );
  });
});
