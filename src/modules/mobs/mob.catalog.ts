export const MOB_RANKS = ['SPAWN', 'EXECUTIONER', 'ARCH_EXECUTIONER', 'REAPER', 'ANCIENT'] as const;
export type MobRank = (typeof MOB_RANKS)[number];

export type MobLootEntry = {
  itemKey: string;
  chance: number;
  minQuantity: number;
  maxQuantity: number;
};

export const MOB_RANK_MULTIPLIERS: Readonly<Record<MobRank, number>> = {
  SPAWN: 1,
  EXECUTIONER: 1.75,
  ARCH_EXECUTIONER: 3,
  REAPER: 5,
  ANCIENT: 8,
};
