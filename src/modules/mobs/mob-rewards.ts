import type { MobLootEntry } from './mob.catalog.js';

export interface AwardedLoot {
  itemKey: string;
  quantity: number;
}

export function rollMobLoot(
  lootTable: readonly MobLootEntry[],
  random: () => number = Math.random,
): AwardedLoot[] {
  const rewards: AwardedLoot[] = [];
  for (const entry of lootTable) {
    if (random() >= entry.chance) continue;
    const spread = Math.max(0, entry.maxQuantity - entry.minQuantity);
    const quantity = entry.minQuantity + Math.floor(random() * (spread + 1));
    rewards.push({ itemKey: entry.itemKey, quantity });
  }
  return rewards;
}
