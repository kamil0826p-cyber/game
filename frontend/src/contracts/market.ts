import type { CharacterClass } from './game';
import type {
  EquipmentSlot,
  ItemCategory,
  ItemRarity,
  ItemStatBonuses,
} from './socket';

export interface MarketItemPayload {
  definitionKey: string;
  name: string;
  description: string;
  icon: string;
  category: ItemCategory;
  rarity: ItemRarity;
  equipmentSlot?: EquipmentSlot;
  requiredClass?: CharacterClass;
  minimumLevel: number;
  statBonuses: ItemStatBonuses;
  powerLevel: number;
  craftQuality: number;
  affixes: Array<{
    name: string;
    tier: number;
    statBonuses: ItemStatBonuses;
  }>;
  relic?: { key: string; name: string; description: string };
  curse?: { key: string; name: string; description: string; preview: string };
}

export type MarketListingStatus = 'ACTIVE' | 'SOLD' | 'CANCELLED' | 'EXPIRED';

export interface MarketListingPayload {
  id: string;
  seller: { characterId: string; name: string };
  buyer?: { characterId: string; name: string };
  item: MarketItemPayload;
  quantity: number;
  totalPriceSilver: number;
  unitPriceSilver: number;
  listingFeeSilver: number;
  commissionSilver: number;
  sellerRevenueSilver: number;
  historicalMedianUnitPriceSilver?: number;
  status: MarketListingStatus;
  createdAt: number;
  expiresAt: number;
  closedAt?: number;
  canBuy: boolean;
  canCancel: boolean;
}

export interface MarketSellableItemPayload {
  inventoryItemId: string;
  item: MarketItemPayload;
  quantity: number;
  suggestedUnitPriceSilver?: number;
}

export interface MarketSnapshot {
  station: { npcId: string; npcName: string; marketKey: string };
  silver: number;
  listings: MarketListingPayload[];
  mine: MarketListingPayload[];
  sellableItems: MarketSellableItemPayload[];
  rules: {
    activeListingLimit: number;
    activeListingCount: number;
    listingTtlMs: number;
    listingFeeRate: number;
    commissionRate: number;
    minimumPriceSilver: number;
    maximumPriceSilver: number;
  };
}

export interface MarketMutationResult {
  snapshot: MarketSnapshot;
  mutation: {
    kind: 'LISTED' | 'PURCHASED' | 'CANCELLED';
    listingId: string;
    itemName: string;
    quantity: number;
    silverDelta: number;
    delivery?: 'INVENTORY' | 'CLAIMS';
    sellerCharacterId?: string;
  };
}

export interface OpenMarketDialogueAction {
  type: 'OPEN_MARKET';
  npcId: string;
  marketKey: string;
}
