import type {
  CombatActionResolutionPayload,
  CombatFinishReason,
  CombatLifecycleStatus,
  CombatSnapshot,
} from '../../contracts/socket.events.js';
import type {
  CombatFallbackPolicy,
  CombatFormationLine,
  CombatTelegraphCounter,
  TacticalCombatAction,
} from '../../contracts/tactical-combat.events.js';
import type { SkillCatalogDefinition } from '../skills/skill.types.js';

export interface CombatRuntimeSkill {
  definition: SkillCatalogDefinition;
  cooldownTurnsRemaining: number;
}

export interface CombatRuntimeStatus {
  id: string;
  key: string;
  turnsRemaining: number;
  magnitude?: number;
  sourceActorId: string;
  sourcePower: number;
  appliedTurn: number;
  harmful?: boolean;
  hardControl?: boolean;
}

export interface CombatControlHistory {
  applications: number;
  lastAppliedTurn: number;
}

export interface CombatRuntimeActor {
  actorId: string;
  teamId: string;
  kind: 'PLAYER' | 'MOB';
  characterId?: string;
  name: string;
  characterClass: 'MAGE' | 'WARRIOR' | 'ARCHER';
  level: number;
  outfitKey: string;
  renderScale?: number;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  strength: number;
  agility: number;
  intelligence: number;
  armor: number;
  formationSlot: number;
  formationLine: CombatFormationLine;
  fallbackPolicy: CombatFallbackPolicy;
  withdrawn: boolean;
  guarding: boolean;
  protectedActorId?: string;
  protectedByActorId?: string;
  statuses: CombatRuntimeStatus[];
  controlHistory: CombatControlHistory;
  skills: Map<string, CombatRuntimeSkill>;
}

export interface CombatRuntimeTeam {
  teamId: string;
  anchorActorId: string;
  sourceGroupId?: string;
  actorIds: string[];
}

export interface CombatRuntimeTelegraph {
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
  reactedByActorIds: Set<string>;
  command: CombatActionCommand;
  interrupted: boolean;
  guardedTargetActorIds: Set<string>;
}

export interface CombatOperationReceipt {
  fingerprint: string;
  snapshot: CombatSnapshot;
}

export interface CombatRuntime {
  combatId: string;
  status: CombatLifecycleStatus;
  phase: 'REQUEST' | 'TURN' | 'REACTION' | 'FINISHED';
  zoneType: 'SAFE' | 'OUTLAW' | 'PVP';
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
  winnerTeamId?: string;
  finishReason?: CombatFinishReason;
  initiatorActorId: string;
  recipientActorId: string;
  teams: [CombatRuntimeTeam, CombatRuntimeTeam];
  actors: CombatRuntimeActor[];
  turnOrder: string[];
  events: CombatActionResolutionPayload[];
  nextSequence: number;
  telegraph?: CombatRuntimeTelegraph;
  operationReceipts: Map<string, CombatOperationReceipt>;
}

export interface CombatActionCommand {
  requestId?: string;
  operationId?: string;
  expectedTurn?: number;
  action: 'BASIC_ATTACK' | 'SKILL' | TacticalCombatAction;
  skillKey?: string;
  targetActorId?: string;
  secondaryTargetActorId?: string;
  telegraphId?: string;
  timedOut?: boolean;
}

export interface CombatActorInput
  extends Omit<
    CombatRuntimeActor,
    | 'teamId'
    | 'withdrawn'
    | 'guarding'
    | 'protectedActorId'
    | 'protectedByActorId'
    | 'statuses'
    | 'controlHistory'
    | 'skills'
    | 'formationSlot'
    | 'formationLine'
    | 'fallbackPolicy'
  > {
  formationSlot?: number;
  fallbackPolicy?: CombatFallbackPolicy;
  skills: readonly CombatRuntimeSkill[];
}

export interface CombatTeamInput {
  anchorActorId: string;
  sourceGroupId?: string;
  actors: readonly CombatActorInput[];
}

export interface CombatEngineResult {
  snapshot: CombatSnapshot;
  changedActorIds: string[];
}
