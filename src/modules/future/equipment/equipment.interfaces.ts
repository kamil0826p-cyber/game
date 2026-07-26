export type EquipmentSlot =
  | 'HEAD'
  | 'CHEST'
  | 'LEGS'
  | 'FEET'
  | 'MAIN_HAND'
  | 'OFF_HAND'
  | 'AMULET'
  | 'RING';

export interface EquippedItemState {
  slot: EquipmentSlot;
  inventoryItemId: string;
  itemKey: string;
  statModifiers: Record<string, number>;
}

export interface EquipmentState {
  characterId: string;
  items: EquippedItemState[];
}
