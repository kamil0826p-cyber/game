import type {
  CharacterClass,
  Direction,
  MapStatePayload,
  PublicPlayerState,
  RealmState,
  SelfCharacterState,
} from './game';

export interface SocketErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export type SocketAck<T> =
  | { ok: true; data: T }
  | { ok: false; error: SocketErrorPayload };

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

export interface WorldSpawnPayload {
  self: SelfCharacterState;
  map: MapStatePayload;
  nearbyPlayers: PublicPlayerState[];
  unlockedOutfits: Array<{ key: string; unlockLevel: number }>;
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
  authoritative: {
    mapId: string;
    x: number;
    y: number;
    direction: Direction;
  };
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
    self: SelfCharacterState;
    nearbyPlayers: PublicPlayerState[];
    serverTime: number;
  }) => void;
  'movement:committed': (payload: MovementCommittedPayload) => void;
  'movement:rejected': (payload: MovementRejectedPayload) => void;
  notification: (payload: SocketErrorPayload) => void;
}
