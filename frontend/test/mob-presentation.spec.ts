import { describe, expect, it } from 'vitest';
import { formatMobLabel, mobRankColor, mobRankLabel } from '../src/game/engine/mobPresentation';

describe('mob presentation', () => {
  it('renders the requested single-line Polish label', () => {
    expect(formatMobLabel({ name: 'Królik', level: 2, rank: 'SPAWN' })).toBe(
      'Królik (2 lv.) Pomiot',
    );
  });

  it('defines labels and colours for every rank', () => {
    expect(Object.keys(mobRankLabel)).toEqual([
      'SPAWN',
      'EXECUTIONER',
      'ARCH_EXECUTIONER',
      'REAPER',
      'ANCIENT',
    ]);
    expect(new Set(Object.values(mobRankColor)).size).toBe(5);
  });
});
