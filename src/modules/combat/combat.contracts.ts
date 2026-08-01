export const COMBAT_CONTRACT_VERSION = 2 as const;
export const COMBAT_RULES_VERSION = 2 as const;

export type CombatFormationLine = 'FRONT' | 'BACK';
export type CombatPhase = 'DECISION' | 'REACTION' | 'RESOLVING';
export type CombatFallbackAction = 'DEFEND' | 'BASIC_ATTACK' | 'SKIP';
export type CombatTacticalAction =
  | 'DEFEND'
  | 'INTERCEPT'
  | 'TAUNT'
  | 'INTERRUPT'
  | 'CLEANSE'
  | 'MARK'
  | 'COUNTER'
  | 'REPOSITION'
  | 'TRANSFER_ENERGY'
  | 'SKIP';

export interface CombatLegalActionPayload {
  action: 'BASIC_ATTACK' | 'SKILL' | CombatTacticalAction;
  skillKey?: string;
  targetActorIds: string[];
  targeting:
    | 'SELF'
    | 'ALLY'
    | 'ENEMY'
    | 'ALL_ALLIES'
    | 'ALL_ENEMIES'
    | 'FRONT_ROW'
    | 'BACK_ROW'
    | 'ADJACENT';
  reactionOnly?: boolean;
}

export interface CombatTelegraphPayload {
  actorId: string;
  skillKey: string;
  label: string;
  targetActorId?: string;
  targetActorIds: string[];
  startedAt: number;
  resolvesAt: number;
  reactionActorIds: string[];
  reactedActorIds: string[];
  interruptedByActorId?: string;
  interruptible: boolean;
}

export interface CombatTimingPayload {
  policyKey: 'STANDARD' | 'TUTORIAL';
  decisionMs: number;
  reactionMs: number;
  disconnectedFallbackMs: number;
  presentationGraceMs: number;
}

export interface CombatDecisionMetricsPayload {
  samples: number;
  medianMs: number;
  p95Ms: number;
}

declare module '../../contracts/socket.events.js' {
  interface CombatParticipantPayload {
    teamId?: string;
    withdrawn?: boolean;
    formationSlot?: number;
    formationLine?: CombatFormationLine;
    guarding?: boolean;
    protectedByActorId?: string;
    disconnected?: boolean;
    physicalDamageReduction?: number;
    magicalDamageReduction?: number;
    controlDrStacks?: number;
  }

  interface CombatActionResultPayload {
    redirectedFromActorId?: string;
    interceptedByActorId?: string;
    rejectedStatusReason?: 'DIMINISHING_RETURNS' | 'IMMUNE' | 'INVALID_TARGET';
    exposedConsumed?: boolean;
    staggerConsumed?: boolean;
    counterDamage?: number;
    cleansedStatuses?: string[];
  }

  interface CombatSnapshot {
    contractVersion?: typeof COMBAT_CONTRACT_VERSION;
    rulesVersion?: typeof COMBAT_RULES_VERSION;
    phase?: CombatPhase;
    eventSequence?: number;
    turnQueue?: string[];
    nextActorId?: string;
    timing?: CombatTimingPayload;
    telegraph?: CombatTelegraphPayload;
    legalActionsByActorId?: Record<string, CombatLegalActionPayload[]>;
    decisionMetrics?: CombatDecisionMetricsPayload;
  }
}
