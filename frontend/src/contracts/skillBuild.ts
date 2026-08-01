import type { CharacterClass } from './game';
import type { SkillDefinitionPayload, SkillTargeting } from './socket';

export type SkillNodeKind = 'ACTIVE' | 'PASSIVE' | 'MODIFIER' | 'KEYSTONE';
export type SkillFallbackAction = 'DEFEND' | 'BASIC_ATTACK' | 'SKIP';
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

export interface SkillSpecializationPayload {
  key: string;
  characterClass: CharacterClass;
  name: string;
  promise: string;
  role: 'DAMAGE' | 'CONTROL' | 'SUPPORT' | 'DEFENSE' | 'HYBRID';
  soloLoop: string;
  groupSynergies: string[];
  threatResponse: string;
  drawback: string;
  icon: string;
  selected: boolean;
  spentPoints: number;
}

export interface SkillBuildNodePayload {
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
  prerequisiteKeys: string[];
  prerequisiteAnyOf?: string[][];
  choiceGroupKey?: string;
  modifiesSkillKey?: string;
  icon: string;
  rank: number;
  available: boolean;
  blockedReasons: string[];
}

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
  points: { earned: number; spent: number; available: number; nextPointAtLevel?: number };
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

export interface SkillRespecPreview {
  valid: boolean;
  reasons: string[];
  costSilver: number;
  points: SkillBuildSnapshot['points'];
  invalidLoadoutIds: string[];
}

export interface SkillLoadoutDraft {
  loadoutId?: string;
  name: string;
  activeSkillKeys: string[];
  passiveNodeKeys: string[];
  fallbackAction: SkillFallbackAction;
}

export interface EffectiveSkillImpact {
  energyCost: number;
  cooldownTurns: number;
  targeting: SkillTargeting;
}
