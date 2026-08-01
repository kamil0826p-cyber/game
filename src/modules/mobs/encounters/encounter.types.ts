import type { CharacterClass } from '../../../common/domain/game.types.js';
import type { CombatFormationLine } from '../../combat/combat.contracts.js';
import type {
  CombatActionCommand,
  CombatActorInput,
  CombatRuntime,
  CombatRuntimeActor,
} from '../../combat/combat.types.js';
import type { MobRank } from '../mob.catalog.js';

export const ENCOUNTER_PARTY_THRESHOLDS = [1, 3, 5, 10] as const;
export type EncounterPartyThreshold = (typeof ENCOUNTER_PARTY_THRESHOLDS)[number];

export type EncounterDifficulty = 'BASE' | 'CHALLENGING' | 'RITUAL';
export type EncounterAiRole =
  | 'LEADER'
  | 'FRONTLINER'
  | 'SUPPORT'
  | 'EXECUTIONER'
  | 'SUMMON'
  | 'OBJECTIVE';

export type EncounterTargetPolicy =
  | 'FRONT_LINE'
  | 'BACK_LINE'
  | 'LOWEST_HP'
  | 'HIGHEST_HP'
  | 'LOWEST_RESOURCE'
  | 'HIGHEST_RESOURCE'
  | 'MARKED_OR_EXPOSED'
  | 'PROTECT_LEADER'
  | 'INTERRUPT_TELEGRAPH'
  | 'REPOSITION'
  | 'RANDOM_LEGAL';

export interface EncounterAiPolicy {
  role: EncounterAiRole;
  targetPolicy: EncounterTargetPolicy;
  actionWeights: Partial<Record<CombatActionCommand['action'], number>>;
  phaseActionPriority?: Partial<Record<string, CombatActionCommand['action'][]>>;
}

export interface EncounterActorTemplate {
  key: string;
  name: string;
  role: EncounterAiRole;
  characterClass: CharacterClass;
  formation: CombatFormationLine;
  levelOffset: number;
  statScale: number;
  outfitKey?: string;
  renderScale?: number;
  skillKeys: string[];
  ai: EncounterAiPolicy;
}

export type EncounterPhaseCondition =
  | { type: 'TURN_AT_LEAST'; turn: number }
  | { type: 'ENEMY_HP_AT_MOST'; ratio: number }
  | { type: 'ACTOR_HP_AT_MOST'; actorKey: string; ratio: number }
  | { type: 'ACTOR_DEFEATED'; actorKey: string }
  | { type: 'LIVING_PLAYERS_AT_MOST'; count: number };

export interface EncounterPhaseDefinition {
  key: string;
  label: string;
  conditions: EncounterPhaseCondition[];
  mechanics: string[];
  arenaModifier?: string;
  summonActorKeys?: string[];
}

export interface EncounterScalingTier {
  minPartySize: EncounterPartyThreshold;
  actorKeys: string[];
  healthMultiplier: number;
  powerMultiplier: number;
  rewardMultiplier: number;
  telegraphTargetCount: number;
  breakCapacity: number;
  targetTurns: number;
  mechanics: string[];
}

export interface EncounterTelegraphRule {
  skillKey: string;
  counters: Array<'DEFEND' | 'INTERRUPT' | 'INTERCEPT' | 'REPOSITION' | 'CLEANSE'>;
  unavoidable?: boolean;
}

export interface EncounterDefinition {
  key: string;
  version: number;
  name: string;
  difficulty: EncounterDifficulty;
  ranks: MobRank[];
  recommendedPartySize: number;
  minimumPartySize: number;
  maximumPartySize: number;
  actors: EncounterActorTemplate[];
  initialActorKeys: string[];
  scaling: EncounterScalingTier[];
  phases: EncounterPhaseDefinition[];
  telegraphs: EncounterTelegraphRule[];
  summonLimit: number;
  reward: {
    minimumActiveTurnRatio: number;
    minimumContribution: number;
    lateJoinCutoff: number;
  };
  victory: { type: 'DEFEAT_ALL' | 'DEFEAT_ACTOR'; actorKey?: string };
  defeat: { type: 'PLAYERS_DEFEATED' | 'TURN_LIMIT'; turnLimit?: number };
}

export interface ScaledEncounter {
  definition: EncounterDefinition;
  tier: EncounterScalingTier;
  partySize: number;
  initialActorKeys: string[];
  pendingSummonKeys: string[];
}

export interface EncounterContribution {
  actorId: string;
  joinedTurn: number;
  actions: number;
  timedOutTurns: number;
  damage: number;
  healing: number;
  protection: number;
  interrupts: number;
  cleanses: number;
  mechanics: number;
}

export interface EncounterEligibility {
  eligible: boolean;
  reason: 'ELIGIBLE' | 'WITHDRAWN' | 'AFK' | 'LATE_JOIN' | 'NO_CONTRIBUTION';
  score: number;
  activeTurnRatio: number;
}

export interface EncounterAiPlan {
  command: CombatActionCommand;
  reason: string;
}

export interface EncounterRuntimeState {
  encounter: ScaledEncounter;
  rootMobId: string;
  rootActorId: string;
  enemyTeamId: string;
  playerTeamId: string;
  phaseIndex: number;
  phaseKey: string;
  arenaModifier?: string;
  processedEventSequence: number;
  summonedActorKeys: Set<string>;
  actorIdByKey: Map<string, string>;
  actorKeyById: Map<string, string>;
  contributions: Map<string, EncounterContribution>;
  aiTrace: string[];
  seed: number;
}

export interface ClaimedEncounter {
  rootActorId: string;
  encounter: ScaledEncounter;
  initialActors: CombatActorInput[];
  pendingActors: Map<string, CombatActorInput>;
}

export interface EncounterExecution {
  state: EncounterRuntimeState;
  pendingActors: Map<string, CombatActorInput>;
}

export interface EncounterRuntimeView {
  runtime: CombatRuntime;
  actor: CombatRuntimeActor;
  state: EncounterRuntimeState;
}
