import type { CharacterClass } from './game';

export type ProgressionStatKey =
  | 'maxHp'
  | 'maxEnergy'
  | 'strength'
  | 'agility'
  | 'intelligence'
  | 'armor';
export type ProgressionStatVector = Record<ProgressionStatKey, number>;
export type MilestoneKey = 'VITALITY' | 'MASTERY' | 'FOCUS' | 'MOBILITY' | 'CONTROL';

export interface MilestoneOptionSnapshot {
  key: MilestoneKey;
  name: string;
  description: string;
  currentRank: number;
  maxRank: number;
  minimumAllocatedBeforeFirstRank: number;
  canAllocate: boolean;
  blockedReason?: string;
  previewEffectiveDelta: ProgressionStatVector;
}

export interface CharacterProgressionSnapshot {
  rulesVersion: number;
  classCurveVersion: number;
  milestoneDefinitionVersion: number;
  respecCostVersion: number;
  resourcePolicy: 'PRESERVE_RATIO';
  characterClass: CharacterClass;
  level: number;
  stateVersion: number;
  current: { hp: number; energy: number; silver: number };
  points: { earned: number; spent: number; available: number };
  sources: {
    base: ProgressionStatVector;
    levels: ProgressionStatVector;
    milestones: ProgressionStatVector;
    equipment: ProgressionStatVector;
    permanent: ProgressionStatVector;
    temporary: ProgressionStatVector;
    legacyAdjustment: ProgressionStatVector;
  };
  rawTotal: ProgressionStatVector;
  effective: ProgressionStatVector;
  derived: {
    primaryStat: 'strength' | 'agility' | 'intelligence';
    armorDamageReduction: number;
    initiative: number;
    dodgeChance: number;
    controlPower: number;
    controlResistance: number;
  };
  softCaps: Array<{
    key: 'ATTRIBUTE' | 'ARMOR' | 'INITIATIVE' | 'CONTROL';
    firstThreshold: number;
    secondThreshold: number;
    middleRate: number;
    highRate: number;
  }>;
  milestones: MilestoneOptionSnapshot[];
  respec: { freeAvailable: boolean; costSilver: number };
}
