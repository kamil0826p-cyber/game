import type {
  CharacterClass,
  EquipmentSlot,
  ItemCategory,
  ItemRarity,
  ItemStatBonuses,
} from './socket';

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

export interface OpenCraftingDialogueAction {
  type: 'OPEN_CRAFTING';
  npcId: string;
  workstationKey: string;
}
