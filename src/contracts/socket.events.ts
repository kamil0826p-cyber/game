import type { Socket, Namespace } from 'socket.io';
import type { AuthContext } from '../auth/auth-context.interface.js';
import type {
  CharacterClass,
  CharacterStats,
  CombatState,
  CurrencyBalance,
  Direction,
  EquipmentSlot,
  ItemCategory,
  ZoneType,
} from '../common/domain/game.types.js';
import type { SupportedLocale } from '../i18n/localization.service.js';
import type { SkillTreeSnapshot } from '../modules/skills/skill.types.js';
import type {
  ChatSendPayload,
  CreateCharacterPayload,
  InventoryDestroyPayload,
  InventoryItemPayload as InventoryItemCommandPayload,
  InventoryMovePayload,
  InventoryRequestPayload,
  MerchantBuyPayload,
  MerchantRequestPayload,
  MerchantSellPayload,
  MoveStepPayload,
  MoveStopPayload,
  MoveTargetPayload,
  NpcDialogueChoicePayload,
  NpcDialogueEndPayload,
  NpcDialogueStartPayload,
  TradeActionPayload,
  TradeGetActivePayload,
  TradeRequestPayload,
  TradeRespondPayload,
  TradeSetItemPayload,
  TradeSetSilverPayload,
  ViewportUpdatePayload,
  SkillRequestPayload,
  SkillUnlockPayload,
  CombatActionPayload,
  CombatGetActivePayload,
  CombatLeavePayload,
  CombatRequestPayload,
  CombatRespondPayload,
} from './socket.schemas.js';

export interface SocketErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
export type SocketAck<T> = { ok: true; data: T } | { ok: false; error: SocketErrorPayload };
export interface PublicPlayerState {
  characterId: string;
  name: string;
  characterClass: CharacterClass;
  level: number;
  outfitKey: string;
  mapId: string;
  x: number;
  y: number;
  direction: Direction;
  combatState: CombatState;
}
export interface SelfCharacterState extends PublicPlayerState, CharacterStats, CurrencyBalance {
  experience: number;
}
export interface CharacterCurrencyUpdatedPayload {
  characterId: string;
  currency: 'SILVER' | 'GOLD';
  amount: number;
  balance: number;
}
export interface MapStatePayload {
  id: string;
  key: string;
  name: string;
  width: number;
  height: number;
  zoneType: ZoneType;
  version: number;
}
export type NpcInteractionType = 'DIALOGUE' | 'MERCHANT' | 'QUEST';
export interface NpcStatePayload {
  id: string;
  key: string;
  name: string;
  mapId: string;
  x: number;
  y: number;
  outfitKey: string;
  interactionType: NpcInteractionType;
  interactionRadius: number;
}
export interface NpcDialogueSnapshot {
  npc: { id: string; key: string; name: string };
  node: { id: string; text: string; choices: Array<{ id: string; label: string }> };
}
export type NpcDialogueAction = { type: 'OPEN_MERCHANT' | 'CLOSE'; npcId: string };
export type NpcDialogueChoiceResult =
  { type: 'NODE'; dialogue: NpcDialogueSnapshot } | { type: 'ACTION'; action: NpcDialogueAction };
export interface WorldSpawnPayload {
  self: SelfCharacterState;
  map: MapStatePayload;
  npcs: NpcStatePayload[];
  nearbyPlayers: PublicPlayerState[];
  unlockedOutfits: Array<{ key: string; unlockLevel: number }>;
  skillTree: SkillTreeSnapshot;
  movementStepMs: number;
  serverTime: number;
}
export interface MovementCommittedPayload {
  requestId?: string;
  source: 'DIRECT' | 'PATH';
  mapId: string;
  x: number;
  y: number;
  direction: Direction;
  serverTime: number;
  portalTransition?: {
    sourceMapId: string;
    destinationMapId: string;
    targetX: number;
    targetY: number;
  };
}
export interface MovementRejectedPayload extends SocketErrorPayload {
  requestId?: string;
  retryAfterMs?: number;
  authoritative: { mapId: string; x: number; y: number; direction: Direction };
}
export interface SessionReadyPayload {
  realm: { id: string; slug: string; name: string };
  requiresCharacter: boolean;
  serverTime: number;
}
export type ChatChannel = 'GLOBAL' | 'LOCAL';
export interface ChatMessagePayload {
  id: string;
  channel: ChatChannel;
  characterId: string;
  author: string;
  text: string;
  mapId: string;
  sentAt: number;
}
export type ItemRarity = 'COMMON' | 'ARTIFACT' | 'MYTHIC';
export interface ItemStatBonuses {
  strength?: number;
  agility?: number;
  intelligence?: number;
  armor?: number;
  maxHp?: number;
  maxEnergy?: number;
}
export interface InventoryItemPayload {
  id: string;
  definitionKey: string;
  name: string;
  description: string;
  category: ItemCategory;
  rarity: ItemRarity;
  icon: string;
  quantity: number;
  stackLimit: number;
  slotIndex: number;
  equippedSlot?: EquipmentSlot;
  equipmentSlot?: EquipmentSlot;
  requiredClass?: CharacterClass;
  minimumLevel: number;
  usable: boolean;
  statBonuses: ItemStatBonuses;
  effect?: { hp?: number; energy?: number };
  buyPriceSilver: number;
  sellPriceSilver: number;
  sellable: boolean;
}
export interface InventoryCharacterSnapshot extends CharacterStats {
  silver: number;
}
export interface InventorySnapshot {
  capacity: number;
  silver: number;
  items: InventoryItemPayload[];
  character?: InventoryCharacterSnapshot;
}
export interface MerchantItemPayload {
  definitionKey: string;
  name: string;
  description: string;
  category: ItemCategory;
  rarity: ItemRarity;
  icon: string;
  stackLimit: number;
  equipmentSlot?: EquipmentSlot;
  requiredClass?: CharacterClass;
  minimumLevel: number;
  statBonuses: ItemStatBonuses;
  effect?: { hp?: number; energy?: number };
  buyPriceSilver: number;
  sellPriceSilver: number;
}
export interface MerchantSnapshot {
  merchant: { id: string; key: string; name: string };
  silver: number;
  items: MerchantItemPayload[];
  inventory: InventorySnapshot;
}
export type TradeLifecycleStatus =
  'REQUESTED' | 'OPEN' | 'LOCKED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
export interface TradeOfferItemPayload {
  inventoryItemId: string;
  definitionKey: string;
  name: string;
  description: string;
  icon: string;
  rarity: ItemRarity;
  quantity: number;
  stackLimit: number;
}
export interface TradeParticipantPayload {
  characterId: string;
  name: string;
  accepted: boolean;
  silver: number;
  items: TradeOfferItemPayload[];
}
export interface TradeSnapshot {
  tradeId: string;
  status: TradeLifecycleStatus;
  expiresAt: number;
  initiator: TradeParticipantPayload;
  recipient: TradeParticipantPayload;
  inventory: InventorySnapshot;
}

export type CombatLifecycleStatus =
  'REQUESTED' | 'ACTIVE' | 'FINISHED' | 'DECLINED' | 'EXPIRED' | 'CANCELLED';
export type CombatFinishReason =
  | 'DEFEATED'
  | 'FORFEIT'
  | 'DISCONNECTED'
  | 'DECLINED'
  | 'REQUEST_EXPIRED'
  | 'CANCELLED'
  | 'SERVER_SHUTDOWN';
export interface CombatStatusPayload {
  key: string;
  turnsRemaining: number;
  magnitude?: number;
}
export interface CombatSkillStatePayload {
  key: string;
  cooldownTurnsRemaining: number;
}
export interface CombatParticipantPayload {
  actorId: string;
  kind: 'PLAYER' | 'MOB';
  characterId?: string;
  name: string;
  characterClass: CharacterClass;
  level: number;
  outfitKey: string;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  shield: number;
  statuses: CombatStatusPayload[];
  skills: CombatSkillStatePayload[];
}
export interface CombatActionResultPayload {
  targetActorId: string;
  hpDelta: number;
  energyDelta: number;
  shieldDelta: number;
  shieldAbsorbed: number;
  dodged: boolean;
  statusesApplied: CombatStatusPayload[];
  statusesRemoved: string[];
}
export interface CombatActionResolutionPayload {
  sequence: number;
  actorId: string;
  targetActorId?: string;
  action: 'BASIC_ATTACK' | 'SKILL' | 'STATUS_TICK' | 'TURN_SKIPPED';
  skillKey?: string;
  label: string;
  animationKey: string;
  visual: {
    castEffectKey: string;
    projectileEffectKey?: string;
    impactEffectKey: string;
    accentColor: string;
    travelMs?: number;
  };
  results: CombatActionResultPayload[];
  occurredAt: number;
}
export interface CombatSnapshot {
  combatId: string;
  status: CombatLifecycleStatus;
  zoneType: ZoneType;
  mapId: string;
  createdAt: number;
  expiresAt?: number;
  startedAt?: number;
  finishedAt?: number;
  turnNumber: number;
  activeActorId?: string;
  turnStartedAt?: number;
  turnEndsAt?: number;
  winnerActorId?: string;
  finishReason?: CombatFinishReason;
  initiatorActorId: string;
  recipientActorId: string;
  participants: [CombatParticipantPayload, CombatParticipantPayload];
  recentActions: CombatActionResolutionPayload[];
}

export interface ClientToServerEvents {
  'character:create': (
    payload: CreateCharacterPayload,
    acknowledgement?: (response: SocketAck<WorldSpawnPayload>) => void,
  ) => void;
  'world:enter': (acknowledgement?: (response: SocketAck<WorldSpawnPayload>) => void) => void;
  'movement:step': (
    payload: MoveStepPayload,
    acknowledgement?: (response: SocketAck<MovementCommittedPayload>) => void,
  ) => void;
  'movement:target': (
    payload: MoveTargetPayload,
    acknowledgement?: (response: SocketAck<{ requestId: string; pathLength: number }>) => void,
  ) => void;
  'movement:stop': (
    payload: MoveStopPayload,
    acknowledgement?: (response: SocketAck<{ stopped: boolean }>) => void,
  ) => void;
  'visibility:viewport': (
    payload: ViewportUpdatePayload,
    acknowledgement?: (response: SocketAck<{ halfWidth: number; halfHeight: number }>) => void,
  ) => void;
  'chat:send': (
    payload: ChatSendPayload,
    acknowledgement?: (response: SocketAck<ChatMessagePayload>) => void,
  ) => void;
  'inventory:get': (
    payload: InventoryRequestPayload,
    acknowledgement?: (response: SocketAck<InventorySnapshot>) => void,
  ) => void;
  'inventory:move': (
    payload: InventoryMovePayload,
    acknowledgement?: (response: SocketAck<InventorySnapshot>) => void,
  ) => void;
  'inventory:equip': (
    payload: InventoryItemCommandPayload,
    acknowledgement?: (response: SocketAck<InventorySnapshot>) => void,
  ) => void;
  'inventory:unequip': (
    payload: InventoryItemCommandPayload,
    acknowledgement?: (response: SocketAck<InventorySnapshot>) => void,
  ) => void;
  'inventory:use': (
    payload: InventoryItemCommandPayload,
    acknowledgement?: (response: SocketAck<InventorySnapshot>) => void,
  ) => void;
  'inventory:destroy': (
    payload: InventoryDestroyPayload,
    acknowledgement?: (response: SocketAck<InventorySnapshot>) => void,
  ) => void;
  'merchant:get': (
    payload: MerchantRequestPayload,
    acknowledgement?: (response: SocketAck<MerchantSnapshot>) => void,
  ) => void;
  'merchant:buy': (
    payload: MerchantBuyPayload,
    acknowledgement?: (response: SocketAck<MerchantSnapshot>) => void,
  ) => void;
  'merchant:sell': (
    payload: MerchantSellPayload,
    acknowledgement?: (response: SocketAck<MerchantSnapshot>) => void,
  ) => void;
  'npc:dialogue:start': (
    payload: NpcDialogueStartPayload,
    acknowledgement?: (response: SocketAck<NpcDialogueSnapshot>) => void,
  ) => void;
  'npc:dialogue:choose': (
    payload: NpcDialogueChoicePayload,
    acknowledgement?: (response: SocketAck<NpcDialogueChoiceResult>) => void,
  ) => void;
  'npc:dialogue:end': (
    payload: NpcDialogueEndPayload,
    acknowledgement?: (response: SocketAck<{ closed: boolean }>) => void,
  ) => void;
  'trade:getActive': (
    payload: TradeGetActivePayload,
    acknowledgement?: (response: SocketAck<TradeSnapshot | null>) => void,
  ) => void;
  'trade:request': (
    payload: TradeRequestPayload,
    acknowledgement?: (response: SocketAck<TradeSnapshot>) => void,
  ) => void;
  'trade:respond': (
    payload: TradeRespondPayload,
    acknowledgement?: (response: SocketAck<TradeSnapshot>) => void,
  ) => void;
  'trade:setItem': (
    payload: TradeSetItemPayload,
    acknowledgement?: (response: SocketAck<TradeSnapshot>) => void,
  ) => void;
  'trade:setSilver': (
    payload: TradeSetSilverPayload,
    acknowledgement?: (response: SocketAck<TradeSnapshot>) => void,
  ) => void;
  'trade:accept': (
    payload: TradeActionPayload,
    acknowledgement?: (response: SocketAck<TradeSnapshot>) => void,
  ) => void;
  'trade:cancel': (
    payload: TradeActionPayload,
    acknowledgement?: (response: SocketAck<TradeSnapshot>) => void,
  ) => void;
  'skills:get': (
    payload: SkillRequestPayload,
    acknowledgement?: (response: SocketAck<SkillTreeSnapshot>) => void,
  ) => void;
  'skills:unlock': (
    payload: SkillUnlockPayload,
    acknowledgement?: (response: SocketAck<SkillTreeSnapshot>) => void,
  ) => void;
  'combat:getActive': (
    payload: CombatGetActivePayload,
    acknowledgement?: (response: SocketAck<CombatSnapshot | null>) => void,
  ) => void;
  'combat:request': (
    payload: CombatRequestPayload,
    acknowledgement?: (response: SocketAck<CombatSnapshot>) => void,
  ) => void;
  'combat:respond': (
    payload: CombatRespondPayload,
    acknowledgement?: (response: SocketAck<CombatSnapshot>) => void,
  ) => void;
  'combat:act': (
    payload: CombatActionPayload,
    acknowledgement?: (response: SocketAck<CombatSnapshot>) => void,
  ) => void;
  'combat:leave': (
    payload: CombatLeavePayload,
    acknowledgement?: (response: SocketAck<CombatSnapshot>) => void,
  ) => void;
}

export interface ServerToClientEvents {
  'session:ready': (payload: SessionReadyPayload) => void;
  'character:required': (payload: { allowedClasses: CharacterClass[] }) => void;
  'world:spawn': (payload: WorldSpawnPayload) => void;
  'world:playerEntered': (payload: PublicPlayerState) => void;
  'world:playerMoved': (payload: PublicPlayerState & { serverTime: number }) => void;
  'world:playerLeft': (payload: { characterId: string }) => void;
  'world:mapChanged': (payload: {
    map: MapStatePayload;
    npcs: NpcStatePayload[];
    self: SelfCharacterState;
    nearbyPlayers: PublicPlayerState[];
    serverTime: number;
  }) => void;
  'movement:committed': (payload: MovementCommittedPayload) => void;
  'movement:rejected': (payload: MovementRejectedPayload) => void;
  'character:currencyUpdated': (payload: CharacterCurrencyUpdatedPayload) => void;
  'chat:message': (payload: ChatMessagePayload) => void;
  'trade:requested': (payload: TradeSnapshot) => void;
  'trade:updated': (payload: TradeSnapshot) => void;
  'combat:requested': (payload: CombatSnapshot) => void;
  'combat:updated': (payload: CombatSnapshot) => void;
  notification: (payload: SocketErrorPayload) => void;
}

export interface InterServerEvents {}
export interface GameSocketData {
  auth?: AuthContext;
  locale?: SupportedLocale;
  userId?: string;
  characterId?: string;
  sessionState?:
    'INITIALIZING' | 'CHARACTER_REQUIRED' | 'CHARACTER_SELECT' | 'IN_WORLD' | 'DISCONNECTED';
  activeNpcDialogue?: { npcId: string; nodeId: string };
  merchantNpcId?: string;
}
export type GameSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  GameSocketData
>;
export type GameNamespace = Namespace<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  GameSocketData
>;
