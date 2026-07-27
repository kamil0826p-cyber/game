import type { Socket, Namespace } from 'socket.io';
import type { AuthContext } from '../auth/auth-context.interface.js';
import type { CharacterClass, CharacterStats, CombatState, CurrencyBalance, Direction, EquipmentSlot, ItemCategory, ZoneType } from '../common/domain/game.types.js';
import type { SupportedLocale } from '../i18n/localization.service.js';
import type { ChatSendPayload, CreateCharacterPayload, InventoryDiscardPayload, InventoryItemPayload as InventoryItemCommandPayload, InventoryMovePayload, InventoryRequestPayload, MerchantBuyPayload, MerchantSellPayload, MoveStepPayload, MoveStopPayload, MoveTargetPayload, ViewportUpdatePayload } from './socket.schemas.js';

export interface SocketErrorPayload { code: string; message: string; details?: Record<string, unknown>; }
export type SocketAck<T> = { ok: true; data: T } | { ok: false; error: SocketErrorPayload };
export interface PublicPlayerState { characterId: string; name: string; characterClass: CharacterClass; level: number; outfitKey: string; mapId: string; x: number; y: number; direction: Direction; combatState: CombatState; }
export interface SelfCharacterState extends PublicPlayerState, CharacterStats, CurrencyBalance { experience: number; }
export interface MapStatePayload { id: string; key: string; name: string; width: number; height: number; zoneType: ZoneType; version: number; }
export interface WorldSpawnPayload { self: SelfCharacterState; map: MapStatePayload; nearbyPlayers: PublicPlayerState[]; unlockedOutfits: Array<{ key: string; unlockLevel: number }>; movementStepMs: number; serverTime: number; }
export interface MovementCommittedPayload { requestId?: string; source: 'DIRECT' | 'PATH'; mapId: string; x: number; y: number; direction: Direction; serverTime: number; portalTransition?: { sourceMapId: string; destinationMapId: string; targetX: number; targetY: number; }; }
export interface MovementRejectedPayload extends SocketErrorPayload { requestId?: string; retryAfterMs?: number; authoritative: { mapId: string; x: number; y: number; direction: Direction; }; }
export interface SessionReadyPayload { realm: { id: string; slug: string; name: string }; requiresCharacter: boolean; serverTime: number; }
export type ChatChannel = 'GLOBAL' | 'LOCAL';
export interface ChatMessagePayload { id: string; channel: ChatChannel; characterId: string; author: string; text: string; mapId: string; sentAt: number; }
export interface InventoryItemPayload { id: string; definitionKey: string; name: string; description: string; category: ItemCategory; icon: string; quantity: number; stackLimit: number; slotIndex: number; equippedSlot?: EquipmentSlot; equipmentSlot?: EquipmentSlot; requiredClass?: CharacterClass; minimumLevel: number; usable: boolean; buyPriceSilver: number; sellPriceSilver: number; sellable: boolean; }
export interface InventorySnapshot { capacity: number; silver: number; items: InventoryItemPayload[]; character?: { hp: number; maxHp: number; energy: number; maxEnergy: number }; }
export interface MerchantItemPayload { definitionKey: string; name: string; description: string; icon: string; stackLimit: number; buyPriceSilver: number; sellPriceSilver: number; }
export interface MerchantSnapshot { merchant: { id: string; key: string; name: string }; silver: number; items: MerchantItemPayload[]; inventory: InventorySnapshot; }

export interface ClientToServerEvents {
  'character:create': (payload: CreateCharacterPayload, acknowledgement?: (response: SocketAck<WorldSpawnPayload>) => void) => void;
  'world:enter': (acknowledgement?: (response: SocketAck<WorldSpawnPayload>) => void) => void;
  'movement:step': (payload: MoveStepPayload, acknowledgement?: (response: SocketAck<MovementCommittedPayload>) => void) => void;
  'movement:target': (payload: MoveTargetPayload, acknowledgement?: (response: SocketAck<{ requestId: string; pathLength: number }>) => void) => void;
  'movement:stop': (payload: MoveStopPayload, acknowledgement?: (response: SocketAck<{ stopped: boolean }>) => void) => void;
  'visibility:viewport': (payload: ViewportUpdatePayload, acknowledgement?: (response: SocketAck<{ halfWidth: number; halfHeight: number }>) => void) => void;
  'chat:send': (payload: ChatSendPayload, acknowledgement?: (response: SocketAck<ChatMessagePayload>) => void) => void;
  'inventory:get': (payload: InventoryRequestPayload, acknowledgement?: (response: SocketAck<InventorySnapshot>) => void) => void;
  'inventory:move': (payload: InventoryMovePayload, acknowledgement?: (response: SocketAck<InventorySnapshot>) => void) => void;
  'inventory:equip': (payload: InventoryItemCommandPayload, acknowledgement?: (response: SocketAck<InventorySnapshot>) => void) => void;
  'inventory:unequip': (payload: InventoryItemCommandPayload, acknowledgement?: (response: SocketAck<InventorySnapshot>) => void) => void;
  'inventory:use': (payload: InventoryItemCommandPayload, acknowledgement?: (response: SocketAck<InventorySnapshot>) => void) => void;
  'inventory:discard': (payload: InventoryDiscardPayload, acknowledgement?: (response: SocketAck<InventorySnapshot>) => void) => void;
  'merchant:get': (payload: InventoryRequestPayload, acknowledgement?: (response: SocketAck<MerchantSnapshot>) => void) => void;
  'merchant:buy': (payload: MerchantBuyPayload, acknowledgement?: (response: SocketAck<MerchantSnapshot>) => void) => void;
  'merchant:sell': (payload: MerchantSellPayload, acknowledgement?: (response: SocketAck<MerchantSnapshot>) => void) => void;
}

export interface ServerToClientEvents {
  'session:ready': (payload: SessionReadyPayload) => void;
  'character:required': (payload: { allowedClasses: CharacterClass[] }) => void;
  'world:spawn': (payload: WorldSpawnPayload) => void;
  'world:playerEntered': (payload: PublicPlayerState) => void;
  'world:playerMoved': (payload: PublicPlayerState & { serverTime: number }) => void;
  'world:playerLeft': (payload: { characterId: string }) => void;
  'world:mapChanged': (payload: { map: MapStatePayload; self: SelfCharacterState; nearbyPlayers: PublicPlayerState[]; serverTime: number; }) => void;
  'movement:committed': (payload: MovementCommittedPayload) => void;
  'movement:rejected': (payload: MovementRejectedPayload) => void;
  'chat:message': (payload: ChatMessagePayload) => void;
  notification: (payload: SocketErrorPayload) => void;
}

export interface InterServerEvents {}
export interface GameSocketData { auth?: AuthContext; locale?: SupportedLocale; userId?: string; characterId?: string; sessionState?: 'INITIALIZING' | 'CHARACTER_REQUIRED' | 'CHARACTER_SELECT' | 'IN_WORLD' | 'DISCONNECTED'; }
export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, GameSocketData>;
export type GameNamespace = Namespace<ClientToServerEvents, ServerToClientEvents, InterServerEvents, GameSocketData>;
