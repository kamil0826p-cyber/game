import type { CharacterClass } from '../../common/domain/game.types.js';
import type {
  CombatEffectOperation,
  SkillCatalogDefinition,
  SkillDefinitionPayload,
  SkillTargeting,
} from './skill.types.js';

export const SKILL_BUILD_RULES_VERSION = 1;
export const SKILL_BUILD_MAX_ACTIVE_ACTIONS = 8;
export const SKILL_BUILD_MAX_PASSIVE_SLOTS = 4;
export const SKILL_BUILD_PASSIVE_BUDGET = 6;
export const SKILL_BUILD_MAX_LOADOUTS = 5;

export type SkillNodeKind = 'ACTIVE' | 'PASSIVE' | 'MODIFIER' | 'KEYSTONE';
export type SkillFallbackAction = 'DEFEND' | 'BASIC_ATTACK' | 'SKIP';

export type SkillModifierOperation =
  | {
      version: 1;
      type: 'SET_TARGETING';
      targeting: Exclude<SkillTargeting, 'AREA'>;
      coefficientMultiplier?: number;
    }
  | {
      version: 1;
      type: 'ADJUST_ENERGY_COST';
      flatDelta: number;
      minimum: number;
    }
  | {
      version: 1;
      type: 'ADJUST_COOLDOWN';
      flatDelta: number;
      minimum: number;
    }
  | {
      version: 1;
      type: 'SCALE_EFFECT';
      effectType: CombatEffectOperation['type'];
      multiplier: number;
    }
  | {
      version: 1;
      type: 'ADD_STATUS_EFFECT';
      statusKey: string;
      durationTurns: number;
      magnitude?: number;
      chance?: number;
    }
  | {
      version: 1;
      type: 'CONSUME_STATUS';
      statusKey: 'EXPOSED' | 'STAGGER' | 'BLEED';
    };

export interface SkillSpecializationDefinition {
  key: string;
  characterClass: CharacterClass;
  name: string;
  promise: string;
  role: 'DAMAGE' | 'CONTROL' | 'SUPPORT' | 'DEFENSE' | 'HYBRID';
  soloLoop: string;
  groupSynergies: readonly [string, string, ...string[]];
  threatResponse: string;
  drawback: string;
  icon: string;
}

export interface SkillBuildNodeDefinition {
  key: string;
  characterClass: CharacterClass;
  specializationKey?: string;
  kind: SkillNodeKind;
  name: string;
  description: string;
  minimumLevel: number;
  maxRank: number;
  pointCost: number;
  passiveCost: number;
  prerequisiteKeys: readonly string[];
  prerequisiteAnyOf?: readonly (readonly string[])[];
  choiceGroupKey?: string;
  modifiesSkillKey?: string;
  modifiersByRank?: readonly (readonly SkillModifierOperation[])[];
  icon: string;
}

export interface SkillBuildCatalog {
  version: number;
  specializations: readonly SkillSpecializationDefinition[];
  nodes: readonly SkillBuildNodeDefinition[];
}

export type SkillLoadoutInvalidReason =
  | 'TOO_MANY_ACTIVE_ACTIONS'
  | 'TOO_MANY_PASSIVES'
  | 'PASSIVE_BUDGET_EXCEEDED'
  | 'UNKNOWN_SKILL'
  | 'SKILL_NOT_LEARNED'
  | 'UNKNOWN_PASSIVE'
  | 'PASSIVE_NOT_LEARNED'
  | 'SPECIALIZATION_MISMATCH'
  | 'DUPLICATE_ENTRY';

export interface SkillLoadoutDefinition {
  id: string;
  name: string;
  activeSkillKeys: string[];
  passiveNodeKeys: string[];
  fallbackAction: SkillFallbackAction;
  version: number;
  isValid: boolean;
  invalidReasons: SkillLoadoutInvalidReason[];
  updatedAt: string;
}

export interface SkillBuildAuditEntry {
  at: string;
  action:
    | 'MIGRATE'
    | 'RANK_UP'
    | 'SPECIALIZATION_SELECT'
    | 'LOADOUT_SAVE'
    | 'LOADOUT_ACTIVATE'
    | 'RESPEC';
  operationId?: string;
  beforeVersion: number;
  afterVersion: number;
  metadata: Record<string, unknown>;
}

export interface SkillBuildOperationRecord {
  kind: 'SPECIALIZATION_SELECT' | 'LOADOUT_SAVE' | 'LOADOUT_ACTIVATE' | 'RESPEC';
  payloadHash: string;
  resultingVersion: number;
}

export interface SkillBuildPersistenceData {
  rulesVersion: number;
  selectedSpecializationKey?: string;
  nodeRanks: Record<string, number>;
  loadouts: SkillLoadoutDefinition[];
  activeLoadoutId?: string;
  freeRespecAvailable: boolean;
  migration: {
    migratedAt: string;
    backup: Array<{
      skillKey: string;
      rank: number;
      cooldownTurnsRemaining: number;
    }>;
  };
  operations: Record<string, SkillBuildOperationRecord>;
  audit: SkillBuildAuditEntry[];
}

export interface SkillBuildNodePayload extends SkillBuildNodeDefinition {
  rank: number;
  available: boolean;
  blockedReasons: string[];
}

export interface SkillSpecializationPayload extends SkillSpecializationDefinition {
  selected: boolean;
  spentPoints: number;
}

export interface SkillBuildSkillPayload extends SkillDefinitionPayload {
  baseImpact: {
    energyCost: number;
    cooldownTurns: number;
    targeting: SkillTargeting;
  };
}

export interface SkillBuildSnapshot {
  characterClass: CharacterClass;
  characterLevel: number;
  rulesVersion: number;
  version: number;
  points: {
    earned: number;
    spent: number;
    available: number;
    nextPointAtLevel?: number;
  };
  skills: SkillBuildSkillPayload[];
  nodes: SkillBuildNodePayload[];
  specializations: SkillSpecializationPayload[];
  selectedSpecializationKey?: string;
  loadouts: SkillLoadoutDefinition[];
  activeLoadoutId?: string;
  activeLoadout?: SkillLoadoutDefinition;
  activeActionLimit: number;
  passiveSlotLimit: number;
  passiveBudget: number;
  freeRespecAvailable: boolean;
  respecCostSilver: number;
}

export interface SkillCombatLoadout {
  definitions: Array<{
    definition: SkillCatalogDefinition;
    cooldownTurnsRemaining: number;
  }>;
  fallbackAction: SkillFallbackAction;
  buildVersion: number;
  loadoutId?: string;
}
