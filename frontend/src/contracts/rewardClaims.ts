import type { CharacterClass } from './game';
import type {
  EquipmentSlot,
  ItemCategory,
  ItemRarity,
} from './socket';

export type RewardClaimStatBonuses = Record<string, number | undefined>;

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
  statBonuses: RewardClaimStatBonuses;
  powerLevel: number;
  craftQuality: number;
  affixes: Array<{
    name: string;
    tier: number;
    statBonuses: RewardClaimStatBonuses;
  }>;
  relic?: { key: string; name: string; description: string };
  curse?: { key: string; name: string; description: string; preview: string };
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
  capacity: {
    matchingStackSpace: number;
    requiredSlots: number;
    freeSlots: number;
    canClaim: boolean;
  };
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
