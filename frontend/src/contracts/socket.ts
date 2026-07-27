import type { CharacterClass, Direction, MapStatePayload, PublicPlayerState, RealmState, SelfCharacterState } from './game';

export type EquipmentSlot = 'HEAD' | 'CHEST' | 'LEGS' | 'FEET' | 'MAIN_HAND' | 'OFF_HAND' | 'AMULET' | 'RING';
export type ItemCategory = 'EQUIPMENT' | 'CONSUMABLE' | 'MATERIAL' | 'QUEST';
export type ItemRarity = 'COMMON' | 'ARTIFACT' | 'MYTHIC';
export interface ItemStatBonuses { strength?: number; agility?: number; intelligence?: number; armor?: number; maxHp?: number; maxEnergy?: number; }
export interface InventoryItemPayload { id: string; definitionKey: string; name: string; description: string; category: ItemCategory; rarity: ItemRarity; icon: string; quantity: number; stackLimit: number; slotIndex: number; equippedSlot?: EquipmentSlot; equipmentSlot?: EquipmentSlot; requiredClass?: CharacterClass; minimumLevel: number; usable: boolean; statBonuses: ItemStatBonuses; effect?: { hp?: number; energy?: number }; buyPriceSilver: number; sellPriceSilver: number; sellable: boolean; }
export interface InventoryCharacterSnapshot { hp: number; maxHp: number; energy: number; maxEnergy: number; strength: number; agility: number; intelligence: number; armor: number; silver: number; }
export interface InventorySnapshot { capacity: number; silver: number; items: InventoryItemPayload[]; character?: InventoryCharacterSnapshot; }
export interface MerchantItemPayload { definitionKey: string; name: string; description: string; category: ItemCategory; rarity: ItemRarity; icon: string; stackLimit: number; equipmentSlot?: EquipmentSlot; requiredClass?: CharacterClass; minimumLevel: number; statBonuses: ItemStatBonuses; effect?: { hp?: number; energy?: number }; buyPriceSilver: number; sellPriceSilver: number; }
export interface MerchantSnapshot { merchant: { id: string; key: string; name: string }; silver: number; items: MerchantItemPayload[]; inventory: InventorySnapshot; }
export interface SocketErrorPayload { code: string; message: string; details?: Record<string, unknown>; }
export type SocketAck<T> = { ok: true; data: T } | { ok: false; error: SocketErrorPayload };
export interface CreateCharacterPayload { requestId: string; name: string; characterClass: CharacterClass; }
export interface MoveStepPayload { requestId: string; direction: Direction; }
export interface MoveTargetPayload { requestId: string; targetX: number; targetY: number; }
export interface MoveStopPayload { requestId?: string; }
export interface ViewportUpdatePayload { requestId: string; halfWidth: number; halfHeight: number; }
export type ChatChannel = 'GLOBAL' | 'LOCAL';
export interface ChatSendPayload { requestId: string; channel: ChatChannel; text: string; }
export interface ChatMessagePayload { id: string; channel: ChatChannel; characterId: string; author: string; text: string; mapId: string; sentAt: number; }
export type NpcInteractionType = 'DIALOGUE' | 'MERCHANT' | 'QUEST';
export interface NpcStatePayload { id: string; key: string; name: string; mapId: string; x: number; y: number; outfitKey: string; interactionType: NpcInteractionType; interactionRadius: number; }
export interface WorldSpawnPayload { self: SelfCharacterState; map: MapStatePayload; npcs: NpcStatePayload[]; nearbyPlayers: PublicPlayerState[]; unlockedOutfits: Array<{ key: string; unlockLevel: number }>; movementStepMs: number; serverTime: number; }
export type CharacterCreateResult = WorldSpawnPayload;
export interface PathAcceptedPayload { requestId: string; pathLength: number; }
export interface MovementStopPayload { stopped: boolean; }
export interface VisibilityViewportPayload { halfWidth: number; halfHeight: number; }
export interface MovementCommittedPayload { requestId?: string; source: 'DIRECT' | 'PATH'; mapId: string; x: number; y: number; direction: Direction; serverTime: number; portalTransition?: { sourceMapId: string; destinationMapId: string; targetX: number; targetY: number; }; }
export interface MovementRejectedPayload extends SocketErrorPayload { requestId?: string; retryAfterMs?: number; authoritative: { mapId: string; x: number; y: number; direction: Direction; }; }
export interface SessionReadyPayload { realm: RealmState; requiresCharacter: boolean; serverTime: number; }

export interface ClientToServerEvents {
  'character:create': (payload: CreateCharacterPayload, acknowledgement: (response: SocketAck<WorldSpawnPayload>) => void) => void;
  'world:enter': (acknowledgement: (response: SocketAck<WorldSpawnPayload>) => void) => void;
  'movement:step': (payload: MoveStepPayload, acknowledgement: (response: SocketAck<MovementCommittedPayload>) => void) => void;
  'movement:target': (payload: MoveTargetPayload, acknowledgement: (response: SocketAck<PathAcceptedPayload>) => void) => void;
  'movement:stop': (payload: MoveStopPayload, acknowledgement: (response: SocketAck<MovementStopPayload>) => void) => void;
  'visibility:viewport': (payload: ViewportUpdatePayload, acknowledgement: (response: SocketAck<VisibilityViewportPayload>) => void) => void;
  'chat:send': (payload: ChatSendPayload, acknowledgement: (response: SocketAck<ChatMessagePayload>) => void) => void;
  'inventory:get': (payload: { requestId: string }, acknowledgement: (response: SocketAck<InventorySnapshot>) => void) => void;
  'inventory:move': (payload: { requestId: string; itemId: string; targetSlotIndex: number }, acknowledgement: (response: SocketAck<InventorySnapshot>) => void) => void;
  'inventory:equip': (payload: { requestId: string; itemId: string }, acknowledgement: (response: SocketAck<InventorySnapshot>) => void) => void;
  'inventory:unequip': (payload: { requestId: string; itemId: string }, acknowledgement: (response: SocketAck<InventorySnapshot>) => void) => void;
  'inventory:use': (payload: { requestId: string; itemId: string }, acknowledgement: (response: SocketAck<InventorySnapshot>) => void) => void;
  'inventory:discard': (payload: { requestId: string; itemId: string; quantity: number }, acknowledgement: (response: SocketAck<InventorySnapshot>) => void) => void;
  'merchant:get': (payload: { requestId: string }, acknowledgement: (response: SocketAck<MerchantSnapshot>) => void) => void;
  'merchant:buy': (payload: { requestId: string; itemKey: string; quantity: number }, acknowledgement: (response: SocketAck<MerchantSnapshot>) => void) => void;
  'merchant:sell': (payload: { requestId: string; itemId: string; quantity: number }, acknowledgement: (response: SocketAck<MerchantSnapshot>) => void) => void;
}

export interface ServerToClientEvents {
  'session:ready': (payload: SessionReadyPayload) => void;
  'character:required': (payload: { allowedClasses: CharacterClass[] }) => void;
  'world:spawn': (payload: WorldSpawnPayload) => void;
  'world:playerEntered': (payload: PublicPlayerState) => void;
  'world:playerMoved': (payload: PublicPlayerState & { serverTime: number }) => void;
  'world:playerLeft': (payload: { characterId: string }) => void;
  'world:mapChanged': (payload: { map: MapStatePayload; npcs: NpcStatePayload[]; self: SelfCharacterState; nearbyPlayers: PublicPlayerState[]; serverTime: number; }) => void;
  'movement:committed': (payload: MovementCommittedPayload) => void;
  'movement:rejected': (payload: MovementRejectedPayload) => void;
  'chat:message': (payload: ChatMessagePayload) => void;
  notification: (payload: SocketErrorPayload) => void;
}
