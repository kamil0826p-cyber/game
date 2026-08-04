import type {
  CharacterClass,
  EquipmentSlot,
  ItemCategory,
} from '../../common/domain/game.types.js';
import type {
  ItemCurseSnapshot,
  ItemRarity,
  ItemRelicEffectSnapshot,
  ItemStatBonuses,
} from './itemization.types.js';

export interface MarketStationSession {
  npcId: string;
  marketKey: string;
}

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
  relic?: Pick<ItemRelicEffectSnapshot, 'key' | 'name' | 'description'>;
  curse?: Pick<ItemCurseSnapshot, 'key' | 'name' | 'description' | 'preview'>;
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

export interface MarketRulesPayload {
  activeListingLimit: number;
  activeListingCount: number;
  listingTtlMs: number;
  listingFeeRate: number;
  commissionRate: number;
  minimumPriceSilver: number;
  maximumPriceSilver: number;
}

export interface MarketSnapshot {
  station: {
    npcId: string;
    npcName: string;
    marketKey: string;
  };
  silver: number;
  listings: MarketListingPayload[];
  mine: MarketListingPayload[];
  sellableItems: MarketSellableItemPayload[];
  rules: MarketRulesPayload;
}

export type MarketMutationKind = 'LISTED' | 'PURCHASED' | 'CANCELLED';

export interface MarketMutationResult {
  snapshot: MarketSnapshot;
  mutation: {
    kind: MarketMutationKind;
    listingId: string;
    itemName: string;
    quantity: number;
    silverDelta: number;
    delivery?: 'INVENTORY' | 'CLAIMS';
    sellerCharacterId?: string;
  };
}

declare module '../../contracts/socket.events.js' {
  interface GameSocketData {
    marketStation?: MarketStationSession;
  }
}
