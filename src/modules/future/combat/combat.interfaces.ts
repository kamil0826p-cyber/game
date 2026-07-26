export type CombatLifecycleState = 'IDLE' | 'IN_BATTLE';
export type CombatTurnPhase = 'WAITING_FOR_ACTION' | 'RESOLVING' | 'FINISHED';

export interface CombatParticipantState {
  actorId: string;
  actorType: 'CHARACTER' | 'MOB';
  team: 'A' | 'B';
  currentHp: number;
  currentEnergy: number;
  initiative: number;
  effects: Array<{ effectKey: string; remainingTurns: number }>;
}

export interface TurnBasedCombatState {
  combatId: string;
  phase: CombatTurnPhase;
  turnNumber: number;
  activeActorId: string;
  actionDeadlineAt: number;
  participants: CombatParticipantState[];
}

export interface CombatActionCommand {
  combatId: string;
  actorId: string;
  actionType: 'BASIC_ATTACK' | 'SKILL' | 'ITEM' | 'PASS';
  targetActorId?: string;
  skillKey?: string;
  inventoryItemId?: string;
}
