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
  boundCharacterId?: string;
  equipConfirmationHash: string;
  requiresEquipConfirmation: boolean;
}

export const toInventoryItemizationPayload = (
  metadata: ItemDefinitionMetadata,
  snapshot: ItemInstanceSnapshot,
): InventoryItemizationPayload => {
  const preview = buildItemEquipPreview(metadata, snapshot);
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
