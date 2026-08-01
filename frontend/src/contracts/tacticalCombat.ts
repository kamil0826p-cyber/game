export type CombatFormationLine = 'FRONT' | 'BACK';
export type CombatPhase = 'DECISION' | 'REACTION' | 'RESOLVING';
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
export type CombatCommandAction = 'BASIC_ATTACK' | 'SKILL' | CombatTacticalAction;

export interface CombatLegalActionPayload {
  action: CombatCommandAction;
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

declare module './socket' {
  interface CombatParticipantPayload {
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
    contractVersion?: 2;
    rulesVersion?: 2;
    phase?: CombatPhase;
    eventSequence?: number;
    turnQueue?: string[];
    nextActorId?: string;
    timing?: {
      policyKey: 'STANDARD' | 'TUTORIAL';
      decisionMs: number;
      reactionMs: number;
      disconnectedFallbackMs: number;
      presentationGraceMs: number;
    };
    telegraph?: CombatTelegraphPayload;
    legalActionsByActorId?: Record<string, CombatLegalActionPayload[]>;
    decisionMetrics?: { samples: number; medianMs: number; p95Ms: number };
  }
}
