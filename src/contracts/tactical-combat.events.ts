import type {
  CombatActionResolutionPayload,
  CombatParticipantPayload,
  CombatSnapshot,
} from './socket.events.js';

export const TACTICAL_COMBAT_CONTRACT_VERSION = 1;

export type CombatFormationLine = 'FRONT' | 'BACK';
export type CombatFallbackPolicy = 'GUARD' | 'BASIC_ATTACK' | 'SKIP';
export type TacticalCombatPhase = 'REQUEST' | 'TURN' | 'REACTION' | 'FINISHED';
export type TacticalCombatAction =
  | 'GUARD'
  | 'INTERCEPT'
  | 'INTERRUPT'
  | 'CLEANSE'
  | 'SWAP'
  | 'SUPPORT_ENERGY'
  | 'SKIP';
export type CombatResolutionTacticalAction =
  | TacticalCombatAction
  | 'TELEGRAPH_DECLARED'
  | 'TELEGRAPH_RESOLVED';
export type CombatTelegraphCounter = 'INTERRUPT' | 'GUARD' | 'INTERCEPT' | 'CLEANSE';

export interface CombatTurnPolicyPayload {
  decisionMs: number;
  reactionMs: number;
  tutorialDecisionMs: number;
}

export interface CombatTelegraphPayload {
  id: string;
  actorId: string;
  skillKey: string;
  label: string;
  targetActorIds: string[];
  declaredAt: number;
  closesAt: number;
  interruptible: boolean;
  counters: CombatTelegraphCounter[];
  publicIntent: string;
  reactedByActorIds: string[];
}

export interface CombatLegalActionPayload {
  actorId: string;
  turnNumber: number;
  actions: Array<{
    action: 'BASIC_ATTACK' | 'SKILL' | TacticalCombatAction;
    skillKey?: string;
    targetActorIds: string[];
    usableDuringReaction?: boolean;
    reason?: string;
  }>;
}

export type TacticalCombatSnapshot = Omit<CombatSnapshot, 'participants'> & {
  participants: CombatParticipantPayload[];
  contractVersion: number;
  phase: TacticalCombatPhase;
  turnOrder: string[];
  lastSequence: number;
  turnPolicy: CombatTurnPolicyPayload;
  telegraph?: CombatTelegraphPayload;
  legalActions: CombatLegalActionPayload[];
};

export type TacticalCombatResolution = CombatActionResolutionPayload & {
  tacticalAction?: CombatResolutionTacticalAction;
  decisionTimeMs?: number;
  timedOut?: boolean;
  operationId?: string;
  reactionToTelegraphId?: string;
};

declare module './socket.events.js' {
  interface CombatParticipantPayload {
    formationSlot?: number;
    formationLine?: CombatFormationLine;
    fallbackPolicy?: CombatFallbackPolicy;
    guarding?: boolean;
    protectedActorId?: string;
    protectedByActorId?: string;
    controlResistanceBasisPoints?: number;
  }

  interface CombatActionResultPayload {
    redirectedFromActorId?: string;
    statusesCleansed?: string[];
    statusResisted?: string;
    reactionChangedOutcome?: boolean;
  }

  interface CombatActionResolutionPayload {
    tacticalAction?: CombatResolutionTacticalAction;
    decisionTimeMs?: number;
    timedOut?: boolean;
    operationId?: string;
    reactionToTelegraphId?: string;
  }

  interface CombatSnapshot {
    contractVersion?: number;
    phase?: TacticalCombatPhase;
    turnOrder?: string[];
    lastSequence?: number;
    turnPolicy?: CombatTurnPolicyPayload;
    telegraph?: CombatTelegraphPayload;
    legalActions?: CombatLegalActionPayload[];
  }
}
