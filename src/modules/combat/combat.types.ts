import type {
  CombatActionResolutionPayload,
  CombatFinishReason,
  CombatLifecycleStatus,
  CombatSnapshot,
} from '../../contracts/socket.events.js';
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
}

export interface CombatRuntimeActor {
  actorId: string;
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
  statuses: CombatRuntimeStatus[];
  skills: Map<string, CombatRuntimeSkill>;
}

export interface CombatRuntime {
  combatId: string;
  status: CombatLifecycleStatus;
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
  finishReason?: CombatFinishReason;
  initiatorActorId: string;
  recipientActorId: string;
  actors: [CombatRuntimeActor, CombatRuntimeActor];
  events: CombatActionResolutionPayload[];
  nextSequence: number;
}

export interface CombatActionCommand {
  action: 'BASIC_ATTACK' | 'SKILL';
  skillKey?: string;
}

export interface CombatActorInput extends Omit<CombatRuntimeActor, 'statuses' | 'skills'> {
  skills: readonly CombatRuntimeSkill[];
}

export interface CombatEngineResult {
  snapshot: CombatSnapshot;
  changedActorIds: string[];
}
