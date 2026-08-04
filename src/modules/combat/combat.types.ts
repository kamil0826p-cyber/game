import './combat.contracts.js';
import type {
  CombatActionResolutionPayload,
  CombatFinishReason,
  CombatLifecycleStatus,
  CombatSnapshot,
} from '../../contracts/socket.events.js';
import type { SkillCatalogDefinition, SkillTargeting } from '../skills/skill.types.js';
import type {
  CombatFallbackAction,
  CombatFormationLine,
  CombatPhase,
  CombatTacticalAction,
} from './combat.contracts.js';
import type { CombatTimingPolicy } from './combat.rules.js';

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
  magicResistance: number;
  formationSlot: number;
  formationLine: CombatFormationLine;
  fallbackAction: CombatFallbackAction;
  withdrawn: boolean;
  disconnectedAt?: number;
  controlDrStacks: number;
  controlDrExpiresTurn: number;
  statuses: CombatRuntimeStatus[];
  skills: Map<string, CombatRuntimeSkill>;
}

export interface CombatRuntimeTeam {
  teamId: string;
  anchorActorId: string;
  sourceGroupId?: string;
  actorIds: string[];
}

export interface CombatRuntimeTelegraph {
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

export interface CombatProcessedOperation {
  fingerprint: string;
  eventSequence: number;
}

export interface CombatRuntime {
  combatId: string;
  status: CombatLifecycleStatus;
  phase: CombatPhase;
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
  timingPolicy: CombatTimingPolicy;
  telegraph?: CombatRuntimeTelegraph;
  events: CombatActionResolutionPayload[];
  nextSequence: number;
  processedOperations: Map<string, CombatProcessedOperation>;
  decisionDurationsMs: number[];
}

export interface CombatActionCommand {
  action: 'BASIC_ATTACK' | 'SKILL' | CombatTacticalAction;
  skillKey?: string;
  targetActorId?: string;
  operationId?: string;
  requestId?: string;
  expectedTurnNumber?: number;
  contractVersion?: 2;
}

export interface CombatActorInput extends Omit<
  CombatRuntimeActor,
  | 'teamId'
  | 'withdrawn'
  | 'statuses'
  | 'skills'
  | 'formationSlot'
  | 'formationLine'
  | 'magicResistance'
  | 'controlDrStacks'
  | 'controlDrExpiresTurn'
  | 'fallbackAction'
  | 'disconnectedAt'
> {
  skills: readonly CombatRuntimeSkill[];
  fallbackAction?: CombatFallbackAction;
  magicResistance?: number;
  formationPreference?: CombatFormationLine;
}

export interface CombatTeamInput {
  anchorActorId: string;
  sourceGroupId?: string;
  actors: readonly CombatActorInput[];
}

export interface CombatLegalAction {
  action: CombatActionCommand['action'];
  skillKey?: string;
  targeting: Exclude<SkillTargeting, 'AREA'>;
  targetActorIds: string[];
  reactionOnly?: boolean;
}

export interface CombatEngineResult {
  snapshot: CombatSnapshot;
  changedActorIds: string[];
}
