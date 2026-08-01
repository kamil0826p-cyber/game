import type { CharacterClass } from '../../common/domain/game.types.js';

export const PROGRESSION_VERSION = 2;
export const PROGRESSION_MILESTONE_INTERVAL = 5;
export const PROGRESSION_NODE_KEYS = [
  'ENDURANCE',
  'PRECISION',
  'RITUAL_KNOWLEDGE',
  'MOBILITY',
  'CONTROL',
] as const;

export type ProgressionNodeKey = (typeof PROGRESSION_NODE_KEYS)[number];
export type ProgressionResourcePolicy = 'CLAMP' | 'ADD_MAX_DELTA';

export interface StatVector {
  maxHp: number;
  maxEnergy: number;
  strength: number;
  agility: number;
  intelligence: number;
  armor: number;
}

export interface StatSources {
  base: StatVector;
  automaticProgression: StatVector;
  milestoneChoices: StatVector;
  legacyAdjustment: StatVector;
  equipment: StatVector;
  temporary: StatVector;
}

export interface ProgressionNodeDefinition {
  key: ProgressionNodeKey;
  name: string;
  description: string;
  maxRank: number;
  bonusesPerRank: StatVector;
}

export interface ProgressionSnapshot {
  version: number;
  characterClass: CharacterClass;
  level: number;
  choices: ProgressionNodeKey[];
  nodeRanks: Record<ProgressionNodeKey, number>;
  points: {
    earned: number;
    spent: number;
    available: number;
    nextPointAtLevel?: number;
  };
  sources: StatSources;
  effective: StatVector;
  derived: {
    physicalPower: number;
    rangedPower: number;
    spellPower: number;
    damageReductionBasisPoints: number;
    effectiveHealth: number;
  };
  limits: {
    primarySoftCap: number;
    primaryHardCap: number;
    armorSoftCap: number;
    armorHardCap: number;
    explanation: string;
  };
  respec: {
    freeRespecs: number;
    silverCost: number;
    allowed: boolean;
  };
}

export interface ProgressionCharacterRecord {
  id: string;
  userId: string;
  characterClass: CharacterClass;
  level: number;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  strength: number;
  agility: number;
  intelligence: number;
  armor: number;
  silver: number;
  combatState: 'IDLE' | 'IN_BATTLE';
  stateVersion: number;
  progressionVersion: number;
  progressionChoices: unknown;
  legacyStatAdjustment: unknown;
  freeProgressionRespecs: number;
  statRevision: number;
}

export interface ProgressionMutationResult {
  snapshot: ProgressionSnapshot;
  hp: number;
  energy: number;
  silver: number;
  stateVersion: number;
  statRevision: number;
}
