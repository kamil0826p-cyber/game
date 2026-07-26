export interface ItemDefinitionContract {
  key: string;
  name: string;
  description: string;
  stackLimit: number;
  itemType: 'CONSUMABLE' | 'EQUIPMENT' | 'QUEST' | 'MATERIAL';
  metadata: Record<string, unknown>;
}

export interface InventorySlotState {
  slotIndex: number;
  inventoryItemId: string;
  itemKey: string;
  quantity: number;
  instanceData: Record<string, unknown>;
}

export interface InventoryState {
  characterId: string;
  capacity: number;
  slots: InventorySlotState[];
}
