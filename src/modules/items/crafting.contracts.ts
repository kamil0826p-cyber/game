import type {
  CharacterClass,
  EquipmentSlot,
  ItemCategory,
} from '../../common/domain/game.types.js';
import type { ItemRarity, ItemStatBonuses } from './itemization.types.js';

export interface CraftingStationSession {
  npcId: string;
  workstationKey: string;
}

export interface CraftingMaterialPayload {
  itemKey: string;
  name: string;
  icon: string;
  requiredQuantity: number;
  ownedQuantity: number;
  enough: boolean;
}

export interface CraftingOutputPayload {
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
  affixCount?: { minimum: number; maximum: number };
  relic?: {
    key: string;
    name: string;
    description: string;
  };
  curse?: {
    key: string;
    name: string;
    description: string;
    preview: string;
  };
}

export interface CraftingAvailabilityPayload {
  levelMet: boolean;
  regionMet: boolean;
  workstationMet: boolean;
  silverMet: boolean;
  materialsMet: boolean;
  canCraft: boolean;
}

export interface CraftOrderCreationAvailabilityPayload {
  regionMet: boolean;
  workstationMet: boolean;
  baseSilverMet: boolean;
  materialsMet: boolean;
  activeOrderLimitMet: boolean;
  canCreate: boolean;
}

export interface CraftingRecipePayload {
  key: string;
  version: number;
  name: string;
  outputQuantity: number;
  silverCost: number;
  requiredLevel: number;
  workstationKey?: string;
  regionKey?: string;
  complexity: number;
  craftQuality: number;
  inputs: CraftingMaterialPayload[];
  output: CraftingOutputPayload;
  availability: CraftingAvailabilityPayload;
  orderAvailability: CraftOrderCreationAvailabilityPayload;
}

export type CraftOrderStatus = 'OPEN' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
export type CraftOrderFulfillBlocker =
  | 'OWN_ORDER'
  | 'LEVEL_REQUIRED'
  | 'REGION_REQUIRED'
  | 'WRONG_WORKSTATION'
  | 'RECIPE_VERSION_MISMATCH'
  | 'ORDER_CLOSED';

export interface CraftOrderPayload {
  id: string;
  recipeKey: string;
  recipeVersion: number;
  recipeName: string;
  owner: { characterId: string; name: string };
  crafter?: { characterId: string; name: string };
  output: CraftingOutputPayload;
  outputQuantity: number;
  requiredLevel: number;
  craftCostSilver: number;
  rewardSilver: number;
  totalEscrowSilver: number;
  status: CraftOrderStatus;
  createdAt: number;
  expiresAt: number;
  completedAt?: number;
  cancelledAt?: number;
  canFulfill: boolean;
  canCancel: boolean;
  fulfillBlockers: CraftOrderFulfillBlocker[];
}

export interface CraftOrderRulesPayload {
  activeOrderLimit: number;
  activeOrderCount: number;
  maximumRewardSilver: number;
  ttlMs: number;
}

export interface CraftOrderCollectionPayload {
  rules: CraftOrderRulesPayload;
  board: CraftOrderPayload[];
  mine: CraftOrderPayload[];
}

export interface CraftingSnapshot {
  station: {
    npcId: string;
    npcName: string;
    workstationKey: string;
  };
  characterLevel: number;
  mapKey: string;
  silver: number;
  recipes: CraftingRecipePayload[];
  orders: CraftOrderCollectionPayload;
}

export interface CraftingResult {
  snapshot: CraftingSnapshot;
  crafted: {
    recipeKey: string;
    definitionKey: string;
    name: string;
    quantity: number;
    delivery: 'INVENTORY' | 'CLAIMS';
  };
}

export type CraftOrderMutationKind = 'CREATED' | 'FULFILLED' | 'CANCELLED';

export interface CraftOrderMutationResult {
  snapshot: CraftingSnapshot;
  mutation: {
    kind: CraftOrderMutationKind;
    orderId: string;
    outputName: string;
    rewardSilver: number;
    ownerCharacterId: string;
    delivery?: 'INVENTORY' | 'CLAIMS';
  };
}

declare module '../../contracts/socket.events.js' {
  interface GameSocketData {
    craftingStation?: CraftingStationSession;
  }
}
