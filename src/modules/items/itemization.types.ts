import type {
  CharacterClass,
  EquipmentSlot,
  ItemCategory,
} from '../../common/domain/game.types.js';
import type { SkillModifierOperation } from '../skills/skill.buildcraft.types.js';

export const ITEM_SNAPSHOT_VERSION = 1 as const;
export const ITEM_AFFIX_RULES_VERSION = 1 as const;
export const ITEM_RELIC_RULES_VERSION = 1 as const;
export const ITEM_LOOT_PROTECTION_VERSION = 1 as const;
export const ITEM_TRIGGER_MAX_DEPTH = 8;

export type ItemRarity = 'COMMON' | 'ARTIFACT' | 'MYTHIC';
export type ItemAffixKind = 'PREFIX' | 'SUFFIX';
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
export type ItemStatKey =
  | 'strength'
  | 'agility'
  | 'intelligence'
  | 'armor'
  | 'maxHp'
  | 'maxEnergy';
export type ItemStatBonuses = Partial<Record<ItemStatKey, number>>;

export interface ItemOriginSnapshot {
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
}

export interface ItemAffixDefinition {
  key: string;
  name: string;
  kind: ItemAffixKind;
  tier: number;
  weight: number;
  tags: readonly string[];
  incompatibleTags: readonly string[];
  classTags?: readonly CharacterClass[];
  minimumPowerLevel: number;
  minimumRoll: number;
  maximumRoll: number;
  powerCost: number;
  stat: ItemStatKey;
}

export interface RolledItemAffix {
  key: string;
  name: string;
  kind: ItemAffixKind;
  tier: number;
  roll: number;
  minimumRoll: number;
  maximumRoll: number;
  powerCost: number;
  tags: string[];
  statBonuses: ItemStatBonuses;
}

export interface ItemRelicEffectDefinition {
  key: string;
  name: string;
  description: string;
  skillKey: string;
  modifier: SkillModifierOperation;
  powerCost: number;
  uniqueGroup: string;
}

export interface ItemRelicEffectSnapshot extends ItemRelicEffectDefinition {
  rulesVersion: number;
}

export type ItemCurseCost =
  | {
      type: 'STAT_PENALTY';
      statBonuses: ItemStatBonuses;
    }
  | {
      type: 'HEALING_RECEIVED_MULTIPLIER';
      multiplier: number;
    }
  | {
      type: 'CONSUMABLE_LOCK';
      category: 'HEALING';
    }
  | {
      type: 'CORRUPTION_ON_TRIGGER';
      trigger: 'SKILL_CAST' | 'GUARD_SUCCESS' | 'COMBAT_END';
      amount: number;
    };

export interface ItemCurseDefinition {
  key: string;
  name: string;
  description: string;
  preview: string;
  cost: ItemCurseCost;
  powerCredit: number;
}

export interface ItemCurseSnapshot extends ItemCurseDefinition {
  rulesVersion: number;
}

export interface ItemMutationSnapshot {
  sequence: number;
  operationId: string;
  type: 'CREATE' | 'AFFIX_REROLL' | 'CRAFT' | 'SALVAGE' | 'MARKET_TRANSFER' | 'BIND';
  at: string;
  beforeHash?: string;
  afterHash: string;
}

export interface ItemInstanceSnapshotV1 {
  version: typeof ITEM_SNAPSHOT_VERSION;
  affixRulesVersion: typeof ITEM_AFFIX_RULES_VERSION;
  relicRulesVersion: typeof ITEM_RELIC_RULES_VERSION;
  definitionKey: string;
  archetypeKey: string;
  category: ItemCategory;
  equipmentSlot?: EquipmentSlot;
  requiredClass?: CharacterClass;
  rarity: ItemRarity;
  powerLevel: number;
  powerBudget: number;
  powerSpent: number;
  seed: string;
  affixes: RolledItemAffix[];
  relic?: ItemRelicEffectSnapshot;
  curse?: ItemCurseSnapshot;
  craftQuality: number;
  origin: ItemOriginSnapshot;
  bindPolicy: ItemBindPolicy;
  tradePolicy: ItemTradePolicy;
  salvagePolicy: ItemSalvagePolicy;
  boundCharacterId?: string;
  mutations: ItemMutationSnapshot[];
}

export type ItemInstanceSnapshot = ItemInstanceSnapshotV1;

export interface ItemDefinitionMechanics {
  version: 1;
  archetypeKey: string;
  powerLevel: number;
  powerBudget: number;
  affixPoolKey?: string;
  affixCount?: { minimum: number; maximum: number };
  relicKey?: string;
  curseKey?: string;
  bindPolicy: ItemBindPolicy;
  tradePolicy: ItemTradePolicy;
  salvagePolicy: ItemSalvagePolicy;
  salvageProfileKey?: string;
}

export interface ItemDefinitionMetadata {
  category: ItemCategory;
  rarity: ItemRarity;
  icon: string;
  equipmentSlot?: EquipmentSlot;
  requiredClass?: CharacterClass;
  minimumLevel?: number;
  effect?: { hp?: number; energy?: number };
  statBonuses?: ItemStatBonuses;
  buyPriceSilver: number;
  sellPriceSilver: number;
  sellable?: boolean;
  mechanics?: ItemDefinitionMechanics;
}

export interface ItemEquipPreview {
  confirmationHash: string;
  requiresConfirmation: boolean;
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
  effectiveStatBonuses: ItemStatBonuses;
}

export interface ItemSalvageOutput {
  itemKey: string;
  quantity: number;
}

export interface ItemSalvageProfile {
  key: string;
  version: number;
  deterministic: ItemSalvageOutput[];
  rare?: {
    itemKey: string;
    chance: number;
    pityKey: string;
    guaranteedAfterMisses: number;
  };
}

export interface ItemRecipeInput {
  itemKey: string;
  quantity: number;
}

export interface ItemRecipeDefinition {
  key: string;
  version: number;
  name: string;
  outputItemKey: string;
  outputQuantity: number;
  silverCost: number;
  inputs: ItemRecipeInput[];
  requiredLevel: number;
  workstationKey?: string;
  regionKey?: string;
  specializationCost: number;
  deterministicSeedSalt: string;
}

export interface ItemCraftOrderSnapshot {
  id: string;
  recipeKey: string;
  recipeVersion: number;
  ownerCharacterId: string;
  crafterCharacterId?: string;
  status: 'OPEN' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
  silverEscrow: number;
  inputs: ItemRecipeInput[];
  expiresAt: number;
  createdAt: number;
  completedAt?: number;
}

export interface MarketListingSnapshot {
  id: string;
  sellerCharacterId: string;
  buyerCharacterId?: string;
  itemDefinitionKey: string;
  quantity: number;
  priceSilver: number;
  listingFeeSilver: number;
  status: 'ACTIVE' | 'SOLD' | 'CANCELLED' | 'EXPIRED';
  expiresAt: number;
  createdAt: number;
  soldAt?: number;
}

export interface ItemClaimSnapshot {
  id: string;
  itemDefinitionKey: string;
  quantity: number;
  reason: string;
  expiresAt: number;
  createdAt: number;
}

export interface LootProtectionState {
  rulesVersion: typeof ITEM_LOOT_PROTECTION_VERSION;
  misses: number;
  ownedUniqueKeys: readonly string[];
}

export interface LootProtectionResult {
  granted: boolean;
  guaranteed: boolean;
  duplicateBlocked: boolean;
  nextMisses: number;
}
