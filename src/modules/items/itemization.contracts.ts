import { ITEM_SALVAGE_PROFILES } from './itemization.catalog.js';
import type {
  ItemBindPolicy,
  ItemCurseCost,
  ItemDefinitionMetadata,
  ItemInstanceSnapshot,
  ItemOriginSnapshot,
  ItemSalvagePolicy,
  ItemTradePolicy,
  RolledItemAffix,
} from './itemization.types.js';
import { buildItemEquipPreview } from './itemization.rules.js';

export interface InventorySalvageOutputPayload {
  itemKey: string;
  quantity: number;
}

export interface InventorySalvagePreviewPayload {
  profileKey: string;
  deterministic: InventorySalvageOutputPayload[];
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
  affixes: RolledItemAffix[];
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
  origin: ItemOriginSnapshot;
  bindPolicy: ItemBindPolicy;
  tradePolicy: ItemTradePolicy;
  salvagePolicy: ItemSalvagePolicy;
  salvage?: InventorySalvagePreviewPayload;
  boundCharacterId?: string;
  equipConfirmationHash: string;
  requiresEquipConfirmation: boolean;
}

export const toInventoryItemizationPayload = (
  metadata: ItemDefinitionMetadata,
  snapshot: ItemInstanceSnapshot,
): InventoryItemizationPayload => {
  const preview = buildItemEquipPreview(metadata, snapshot);
  const salvageProfileKey = metadata.mechanics?.salvageProfileKey;
  const salvageProfile = salvageProfileKey
    ? ITEM_SALVAGE_PROFILES[salvageProfileKey]
    : undefined;
  return {
    snapshotVersion: snapshot.version,
    powerLevel: snapshot.powerLevel,
    powerBudget: snapshot.powerBudget,
    powerSpent: snapshot.powerSpent,
    affixes: snapshot.affixes.map((affix) => ({
      ...affix,
      tags: [...affix.tags],
      statBonuses: { ...affix.statBonuses },
    })),
    relic: preview.relic,
    curse: preview.curse,
    craftQuality: snapshot.craftQuality,
    origin: { ...snapshot.origin },
    bindPolicy: snapshot.bindPolicy,
    tradePolicy: snapshot.tradePolicy,
    salvagePolicy: snapshot.salvagePolicy,
    salvage:
      snapshot.salvagePolicy === 'ALLOWED' && salvageProfile
        ? {
            profileKey: salvageProfile.key,
            deterministic: salvageProfile.deterministic.map((output) => ({ ...output })),
            rare: salvageProfile.rare
              ? {
                  itemKey: salvageProfile.rare.itemKey,
                  chance: salvageProfile.rare.chance,
                  guaranteedAfterMisses: salvageProfile.rare.guaranteedAfterMisses,
                }
              : undefined,
          }
        : undefined,
    boundCharacterId: snapshot.boundCharacterId,
    equipConfirmationHash: preview.confirmationHash,
    requiresEquipConfirmation: preview.requiresConfirmation,
  };
};

declare module '../../contracts/socket.events.js' {
  interface InventoryItemPayload {
    itemization?: InventoryItemizationPayload;
  }

  interface MerchantItemPayload {
    itemization?: InventoryItemizationPayload;
  }
}
