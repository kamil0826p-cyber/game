import type { CombatParticipantPayload, CombatSnapshot } from './socket';

export type CombatFormationLine = 'FRONT' | 'BACK';
export type CombatFallbackPolicy = 'GUARD' | 'BASIC_ATTACK' | 'SKIP';
export type TacticalCombatAction =
  | 'GUARD'
  | 'INTERCEPT'
  | 'INTERRUPT'
  | 'CLEANSE'
  | 'SWAP'
  | 'SUPPORT_ENERGY'
  | 'SKIP';

export interface CombatTelegraphPayload {
  id: string;
  actorId: string;
  skillKey: string;
  label: string;
  targetActorIds: string[];
  declaredAt: number;
  closesAt: number;
  interruptible: boolean;
  counters: Array<'INTERRUPT' | 'GUARD' | 'INTERCEPT' | 'CLEANSE'>;
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

declare module './socket' {
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
    tacticalAction?: TacticalCombatAction | 'TELEGRAPH_DECLARED' | 'TELEGRAPH_RESOLVED';
    decisionTimeMs?: number;
    timedOut?: boolean;
    operationId?: string;
    reactionToTelegraphId?: string;
  }

  interface CombatSnapshot {
    contractVersion?: number;
    phase?: 'REQUEST' | 'TURN' | 'REACTION' | 'FINISHED';
    turnOrder?: string[];
    lastSequence?: number;
    turnPolicy?: { decisionMs: number; reactionMs: number; tutorialDecisionMs: number };
    telegraph?: CombatTelegraphPayload;
    legalActions?: CombatLegalActionPayload[];
  }
}

export function tacticalParticipant(
  combat: CombatSnapshot,
  actorId: string,
): CombatParticipantPayload | undefined {
  return combat.participants.find((participant) => participant.actorId === actorId);
}
