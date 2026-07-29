import { describe, expect, it } from 'vitest';
import { rollMobLoot } from '../src/modules/mobs/mob-rewards.js';

const lootTable = [
  { itemKey: 'common-drop', chance: 0.8, minQuantity: 1, maxQuantity: 1 },
  { itemKey: 'rare-drop', chance: 0.1, minQuantity: 1, maxQuantity: 1 },
] as const;

describe('mob loot rolls', () => {
  it('rolls every loot entry independently', () => {
    const rolls = [0.2, 0, 0.5, 0];
    const result = rollMobLoot(lootTable, () => rolls.shift() ?? 1);

    expect(result).toEqual([{ itemKey: 'common-drop', quantity: 1 }]);
  });

  it('can award both common and rare items from the same mob', () => {
    const rolls = [0.2, 0, 0.05, 0];
    const result = rollMobLoot(lootTable, () => rolls.shift() ?? 1);

    expect(result).toEqual([
      { itemKey: 'common-drop', quantity: 1 },
      { itemKey: 'rare-drop', quantity: 1 },
    ]);
  });

  it('can award the rare item without the common item', () => {
    const rolls = [0.95, 0.05, 0];
    const result = rollMobLoot(lootTable, () => rolls.shift() ?? 1);

    expect(result).toEqual([{ itemKey: 'rare-drop', quantity: 1 }]);
  });
});
