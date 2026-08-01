import type {
  ItemBindPolicy,
  ItemCurseCost,
  ItemOriginSnapshot,
  ItemSalvagePolicy,
  ItemTradePolicy,
  RolledItemAffix,
} from './itemization.types.js';

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

declare module '../../contracts/socket.events.js' {
  interface InventoryItemPayload {
    itemization?: InventoryItemizationPayload;
  }
}
