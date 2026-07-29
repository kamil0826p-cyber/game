export const MOB_RANKS = ['SPAWN', 'EXECUTIONER', 'ARCH_EXECUTIONER', 'REAPER', 'ANCIENT'] as const;
export type MobRank = (typeof MOB_RANKS)[number];

export interface MobLootEntry {
  itemKey: string;
  chance: number;
  minQuantity: number;
  maxQuantity: number;
}

export interface MobCatalogDefinition {
  key: string;
  name: string;
  rank: MobRank;
  mapKey: string;
  level: number;
  outfitKey: string;
  spawnPoints: readonly { x: number; y: number }[];
  respawnMs: number;
  experience: number;
  stats: {
    maxHp: number;
    maxEnergy: number;
    strength: number;
    agility: number;
    intelligence: number;
    armor: number;
  };
  loot: readonly MobLootEntry[];
}

export const MOB_RANK_MULTIPLIERS: Readonly<Record<MobRank, number>> = {
  SPAWN: 1,
  EXECUTIONER: 1.75,
  ARCH_EXECUTIONER: 3,
  REAPER: 5,
  ANCIENT: 8,
};

export const MOB_CATALOG: readonly MobCatalogDefinition[] = [
  {
    key: 'spawn-rabbit',
    name: 'Królik Pomiot',
    rank: 'SPAWN',
    mapKey: 'greenfields',
    level: 2,
    outfitKey: 'mob-spawn-rabbit',
    spawnPoints: [
      { x: 9, y: 8 },
      { x: 12, y: 10 },
      { x: 18, y: 12 },
      { x: 22, y: 8 },
    ],
    respawnMs: 15_000,
    experience: 28,
    stats: { maxHp: 72, maxEnergy: 0, strength: 9, agility: 12, intelligence: 1, armor: 3 },
    loot: [
      { itemKey: 'rabbit-fur', chance: 0.65, minQuantity: 1, maxQuantity: 2 },
      { itemKey: 'rabbit-foot', chance: 0.12, minQuantity: 1, maxQuantity: 1 },
      { itemKey: 'minor-health-potion', chance: 0.08, minQuantity: 1, maxQuantity: 1 },
    ],
  },
  {
    key: 'executioner-scorpion',
    name: 'Skorpion Kat',
    rank: 'EXECUTIONER',
    mapKey: 'crystal-cave',
    level: 7,
    outfitKey: 'mob-executioner-scorpion',
    spawnPoints: [
      { x: 8, y: 7 },
      { x: 13, y: 11 },
      { x: 19, y: 9 },
    ],
    respawnMs: 30_000,
    experience: 145,
    stats: { maxHp: 310, maxEnergy: 0, strength: 31, agility: 18, intelligence: 3, armor: 17 },
    loot: [
      { itemKey: 'scorpion-chitin', chance: 0.72, minQuantity: 1, maxQuantity: 3 },
      { itemKey: 'scorpion-stinger', chance: 0.24, minQuantity: 1, maxQuantity: 1 },
      { itemKey: 'venom-sac', chance: 0.09, minQuantity: 1, maxQuantity: 1 },
      { itemKey: 'minor-health-potion', chance: 0.06, minQuantity: 1, maxQuantity: 2 },
    ],
  },
] as const;
