import type {
  CharacterClass,
  Direction,
  MapStatePayload,
  PublicPlayerState,
  RealmState,
  SelfCharacterState,
  ZoneType,
} from './game';
export type EquipmentSlot =
  'HEAD' | 'CHEST' | 'LEGS' | 'FEET' | 'MAIN_HAND' | 'OFF_HAND' | 'AMULET' | 'RING';
export type ItemCategory = 'EQUIPMENT' | 'CONSUMABLE' | 'MATERIAL' | 'QUEST';
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
export interface InventoryCharacterSnapshot {
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  strength: number;
  agility: number;
  intelligence: number;
  armor: number;
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
  visual: SkillVisualDefinition;
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
export type SkillTargeting = 'SELF' | 'ENEMY' | 'AREA';
export type SkillUnlockState =
  'UNLOCKED' | 'AVAILABLE' | 'LOCKED_LEVEL' | 'LOCKED_PREREQUISITE' | 'LOCKED_POINTS';
export type CombatEffectOperation =
  | {
      type: 'DAMAGE';
      scaling: 'STRENGTH' | 'AGILITY' | 'INTELLIGENCE' | 'MAX_HP';
      coefficient: number;
      damageType: 'PHYSICAL' | 'ARCANE' | 'FIRE' | 'FROST';
      armorPenetration?: number;
      targetHpBelow?: number;
      bonusCoefficient?: number;
    }
  | {
      type: 'APPLY_STATUS';
      statusKey: string;
      durationTurns: number;
      magnitude?: number;
      chance?: number;
    }
  | {
      type: 'HEAL';
      scaling: 'STRENGTH' | 'AGILITY' | 'INTELLIGENCE' | 'MAX_HP';
      coefficient: number;
    }
  | {
      type: 'SHIELD';
      scaling: 'STRENGTH' | 'AGILITY' | 'INTELLIGENCE' | 'MAX_HP';
      coefficient: number;
      durationTurns: number;
    };
export interface SkillVisualDefinition {
  castEffectKey: string;
  projectileEffectKey?: string;
  impactEffectKey: string;
  accentColor: string;
  travelMs?: number;
}
export interface SkillDefinitionPayload {
  key: string;
  name: string;
  description: string;
  characterClass: CharacterClass;
  minimumLevel: number;
  energyCost: number;
  cooldownTurns: number;
  targeting: SkillTargeting;
  maxRank: number;
  displayOrder: number;
  treeRow: number;
  treeColumn: number;
  icon: string;
  prerequisiteKeys: string[];
  effects: CombatEffectOperation[];
  animationKey: string;
  visual: SkillVisualDefinition;
  rank: number;
  cooldownTurnsRemaining: number;
  unlockState: SkillUnlockState;
  missingPrerequisiteKeys: string[];
}
export interface SkillTreeSnapshot {
  characterClass: CharacterClass;
  characterLevel: number;
  points: { earned: number; spent: number; available: number; nextPointAtLevel?: number };
  skills: SkillDefinitionPayload[];
}
export interface SocketErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
export type SocketAck<T> = { ok: true; data: T } | { ok: false; error: SocketErrorPayload };
export interface CreateCharacterPayload {
  requestId: string;
  name: string;
  characterClass: CharacterClass;
}
export interface MoveStepPayload {
  requestId: string;
  direction: Direction;
}
export interface MoveTargetPayload {
  requestId: string;
  targetX: number;
  targetY: number;
}
export interface MoveStopPayload {
  requestId?: string;
}
export interface ViewportUpdatePayload {
  requestId: string;
  halfWidth: number;
  halfHeight: number;
}
export type ChatChannel = 'GLOBAL' | 'LOCAL';
export interface ChatSendPayload {
  requestId: string;
  channel: ChatChannel;
  text: string;
}
export interface ChatMessagePayload {
  id: string;
  channel: ChatChannel;
  characterId: string;
  author: string;
  text: string;
  mapId: string;
  sentAt: number;
}
export interface CharacterCurrencyUpdatedPayload {
  characterId: string;
  currency: 'SILVER' | 'GOLD';
  amount: number;
  balance: number;
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
  | { type: 'NODE'; dialogue: NpcDialogueSnapshot }
  | { type: 'ACTION'; action: NpcDialogueAction };
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
export type CharacterCreateResult = WorldSpawnPayload;
export interface PathAcceptedPayload {
  requestId: string;
  pathLength: number;
}
export interface MovementStopPayload {
  stopped: boolean;
}
export interface VisibilityViewportPayload {
  halfWidth: number;
  halfHeight: number;
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
  realm: RealmState;
  requiresCharacter: boolean;
  serverTime: number;
}
export interface ClientToServerEvents {
  'character:create': (
    payload: CreateCharacterPayload,
    acknowledgement: (response: SocketAck<WorldSpawnPayload>) => void,
  ) => void;
  'world:enter': (acknowledgement: (response: SocketAck<WorldSpawnPayload>) => void) => void;
  'movement:step': (
    payload: MoveStepPayload,
    acknowledgement: (response: SocketAck<MovementCommittedPayload>) => void,
  ) => void;
  'movement:target': (
    payload: MoveTargetPayload,
    acknowledgement: (response: SocketAck<PathAcceptedPayload>) => void,
  ) => void;
  'movement:stop': (
    payload: MoveStopPayload,
    acknowledgement: (response: SocketAck<MovementStopPayload>) => void,
  ) => void;
  'visibility:viewport': (
    payload: ViewportUpdatePayload,
    acknowledgement: (response: SocketAck<VisibilityViewportPayload>) => void,
  ) => void;
  'chat:send': (
    payload: ChatSendPayload,
    acknowledgement: (response: SocketAck<ChatMessagePayload>) => void,
  ) => void;
  'inventory:get': (
    payload: { requestId: string },
    acknowledgement: (response: SocketAck<InventorySnapshot>) => void,
  ) => void;
  'inventory:move': (
    payload: { requestId: string; itemId: string; targetSlotIndex: number },
    acknowledgement: (response: SocketAck<InventorySnapshot>) => void,
  ) => void;
  'inventory:equip': (
    payload: { requestId: string; itemId: string },
    acknowledgement: (response: SocketAck<InventorySnapshot>) => void,
  ) => void;
  'inventory:unequip': (
    payload: { requestId: string; itemId: string },
    acknowledgement: (response: SocketAck<InventorySnapshot>) => void,
  ) => void;
  'inventory:use': (
    payload: { requestId: string; itemId: string },
    acknowledgement: (response: SocketAck<InventorySnapshot>) => void,
  ) => void;
  'inventory:destroy': (
    payload: { requestId: string; itemId: string; quantity: number },
    acknowledgement: (response: SocketAck<InventorySnapshot>) => void,
  ) => void;
  'merchant:get': (
    payload: { requestId: string; npcId: string },
    acknowledgement: (response: SocketAck<MerchantSnapshot>) => void,
  ) => void;
  'merchant:buy': (
    payload: { requestId: string; npcId: string; itemKey: string; quantity: number },
    acknowledgement: (response: SocketAck<MerchantSnapshot>) => void,
  ) => void;
  'merchant:sell': (
    payload: { requestId: string; npcId: string; itemId: string; quantity: number },
    acknowledgement: (response: SocketAck<MerchantSnapshot>) => void,
  ) => void;
  'npc:dialogue:start': (
    payload: { requestId: string; npcId: string },
    acknowledgement: (response: SocketAck<NpcDialogueSnapshot>) => void,
  ) => void;
  'npc:dialogue:choose': (
    payload: { requestId: string; npcId: string; nodeId: string; choiceId: string },
    acknowledgement: (response: SocketAck<NpcDialogueChoiceResult>) => void,
  ) => void;
  'npc:dialogue:end': (
    payload: { requestId: string; npcId: string },
    acknowledgement: (response: SocketAck<{ closed: boolean }>) => void,
  ) => void;
  'trade:getActive': (
    payload: { requestId: string },
    acknowledgement: (response: SocketAck<TradeSnapshot | null>) => void,
  ) => void;
  'trade:request': (
    payload: { requestId: string; targetCharacterId: string },
    acknowledgement: (response: SocketAck<TradeSnapshot>) => void,
  ) => void;
  'trade:respond': (
    payload: { requestId: string; tradeId: string; accept: boolean },
    acknowledgement: (response: SocketAck<TradeSnapshot>) => void,
  ) => void;
  'trade:setItem': (
    payload: { requestId: string; tradeId: string; itemId: string; quantity: number },
    acknowledgement: (response: SocketAck<TradeSnapshot>) => void,
  ) => void;
  'trade:setSilver': (
    payload: { requestId: string; tradeId: string; silver: number },
    acknowledgement: (response: SocketAck<TradeSnapshot>) => void,
  ) => void;
  'trade:accept': (
    payload: { requestId: string; tradeId: string },
    acknowledgement: (response: SocketAck<TradeSnapshot>) => void,
  ) => void;
  'trade:cancel': (
    payload: { requestId: string; tradeId: string },
    acknowledgement: (response: SocketAck<TradeSnapshot>) => void,
  ) => void;
  'skills:get': (
    payload: { requestId: string },
    acknowledgement: (response: SocketAck<SkillTreeSnapshot>) => void,
  ) => void;
  'skills:unlock': (
    payload: { requestId: string; skillKey: string },
    acknowledgement: (response: SocketAck<SkillTreeSnapshot>) => void,
  ) => void;
  'combat:getActive': (
    payload: { requestId: string },
    acknowledgement: (response: SocketAck<CombatSnapshot | null>) => void,
  ) => void;
  'combat:request': (
    payload: { requestId: string; targetCharacterId: string },
    acknowledgement: (response: SocketAck<CombatSnapshot>) => void,
  ) => void;
  'combat:respond': (
    payload: { requestId: string; combatId: string; accept: boolean },
    acknowledgement: (response: SocketAck<CombatSnapshot>) => void,
  ) => void;
  'combat:act': (
    payload:
      | { requestId: string; combatId: string; action: 'BASIC_ATTACK' }
      | { requestId: string; combatId: string; action: 'SKILL'; skillKey: string },
    acknowledgement: (response: SocketAck<CombatSnapshot>) => void,
  ) => void;
  'combat:leave': (
    payload: { requestId: string; combatId: string },
    acknowledgement: (response: SocketAck<CombatSnapshot>) => void,
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
