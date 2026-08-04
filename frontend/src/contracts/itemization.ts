import type { ItemRarity, ItemStatBonuses } from './socket';

export type ItemBindPolicy = 'NONE' | 'ON_EQUIP' | 'ON_PICKUP';
export type ItemTradePolicy = 'TRADEABLE' | 'ACCOUNT_BOUND' | 'CHARACTER_BOUND';
export type ItemSalvagePolicy = 'ALLOWED' | 'FORBIDDEN';
export type ItemOriginSource =
  | 'LEGACY'
  | 'MERCHANT'
  | 'LOOT'
  | 'CRAFT'
  | 'SALVAGE'
  | 'MARKET'
  | 'QUEST'
  | 'ADMIN';

export type ItemCurseCost =
  | { type: 'STAT_PENALTY'; statBonuses: ItemStatBonuses }
  | { type: 'HEALING_RECEIVED_MULTIPLIER'; multiplier: number }
  | { type: 'CONSUMABLE_LOCK'; category: 'HEALING' }
  | {
      type: 'CORRUPTION_ON_TRIGGER';
      trigger: 'SKILL_CAST' | 'GUARD_SUCCESS' | 'COMBAT_END';
      amount: number;
    };

export interface RolledItemAffixPayload {
  key: string;
  name: string;
  kind: 'PREFIX' | 'SUFFIX';
  tier: number;
  roll: number;
  minimumRoll: number;
  maximumRoll: number;
  powerCost: number;
  tags: string[];
  statBonuses: ItemStatBonuses;
}

export interface InventorySalvagePreviewPayload {
  profileKey: string;
  deterministic: Array<{
    itemKey: string;
    quantity: number;
  }>;
  rare?: {
    itemKey: string;
    chance: number;
    guaranteedAfterMisses: number;
  };
}

export interface InventoryItemizationPayload {
  snapshotVersion: number;
  powerLevel: number;
  powerBudget: number;
  powerSpent: number;
  affixes: RolledItemAffixPayload[];
  relic?: {
    key: string;
    name: string;
    description: string;
    skillKey: string;
  };
  curse?: {
    key: string;
    name: string;
    description: string;
    preview: string;
    cost: ItemCurseCost;
  };
  craftQuality: number;
  origin: {
    source: ItemOriginSource;
    sourceKey: string;
    operationId: string;
    contentVersion: number;
    generatedAt: string;
    encounterKey?: string;
    recipeKey?: string;
    recipeVersion?: number;
    crafterCharacterId?: string;
    previousOwnerCharacterId?: string;
  };
  bindPolicy: ItemBindPolicy;
  tradePolicy: ItemTradePolicy;
  salvagePolicy: ItemSalvagePolicy;
  salvage?: InventorySalvagePreviewPayload;
  boundCharacterId?: string;
  equipConfirmationHash: string;
  requiresEquipConfirmation: boolean;
}

export interface MarketListingPayload {
  id: string;
  sellerCharacterId: string;
  itemDefinitionKey: string;
  itemName: string;
  rarity: ItemRarity;
  quantity: number;
  priceSilver: number;
  expiresAt: number;
  historicalMedianSilver?: number;
}

declare module './socket' {
  interface InventoryItemPayload {
    itemization?: InventoryItemizationPayload;
  }

  interface MerchantItemPayload {
    itemization?: InventoryItemizationPayload;
  }
}
