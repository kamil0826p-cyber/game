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

export type RewardClaimSource =
  | 'MARKET'
  | 'CRAFTING'
  | 'COMBAT'
  | 'QUEST'
  | 'LOOT'
  | 'ADMIN'
  | 'OTHER';

export interface RewardClaimItemPayload {
  definitionKey: string;
  name: string;
  description: string;
  icon: string;
  category: ItemCategory;
  rarity: ItemRarity;
  equipmentSlot?: EquipmentSlot;
  requiredClass?: CharacterClass;
  minimumLevel: number;
  stackLimit: number;
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

export interface RewardClaimCapacityPayload {
  matchingStackSpace: number;
  requiredSlots: number;
  freeSlots: number;
  canClaim: boolean;
}

export interface RewardClaimPayload {
  id: string;
  item: RewardClaimItemPayload;
  quantity: number;
  reason: string;
  source: RewardClaimSource;
  createdAt: number;
  expiresAt: number;
  expiresInMs: number;
  expiringSoon: boolean;
  capacity: RewardClaimCapacityPayload;
}

export interface RewardClaimsSnapshot {
  claims: RewardClaimPayload[];
  summary: {
    totalClaims: number;
    totalQuantity: number;
    expiringSoonCount: number;
    inventorySlotsUsed: number;
    inventoryCapacity: number;
    freeSlots: number;
  };
  refreshedAt: number;
}

export interface RewardClaimMutationResult {
  snapshot: RewardClaimsSnapshot;
  mutation: {
    kind: 'CLAIMED' | 'CLAIMED_ALL';
    claimedIds: string[];
    claimedCount: number;
    claimedQuantity: number;
    blockedIds: string[];
    expiredIds: string[];
  };
}

export interface RewardClaimExpirationResult {
  expiredCount: number;
  characterIds: string[];
}
