import type { MobStatePayload } from '../../contracts/mob';

export const mobRankLabel: Record<MobStatePayload['rank'], string> = {
  SPAWN: 'Pomiot',
  EXECUTIONER: 'Kat',
  ARCH_EXECUTIONER: 'Arcykat',
  REAPER: 'Żniwiarz',
  ANCIENT: 'Przedwieczny',
};

export const mobRankColor: Record<MobStatePayload['rank'], number> = {
  SPAWN: 0xd9f99d,
  EXECUTIONER: 0xfca5a5,
  ARCH_EXECUTIONER: 0xc4b5fd,
  REAPER: 0x67e8f9,
  ANCIENT: 0xfcd34d,
};

export function formatMobLabel(mob: Pick<MobStatePayload, 'name' | 'level' | 'rank'>): string {
  return `${mob.name} (${mob.level} lv.) ${mobRankLabel[mob.rank]}`;
}
