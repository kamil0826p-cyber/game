import type { CharacterClass } from './game';

export const PROGRESSION_NODE_KEYS = [
  'ENDURANCE',
  'PRECISION',
  'RITUAL_KNOWLEDGE',
  'MOBILITY',
  'CONTROL',
] as const;
export type ProgressionNodeKey = (typeof PROGRESSION_NODE_KEYS)[number];

export interface ProgressionStatVector {
  maxHp: number;
  maxEnergy: number;
  strength: number;
  agility: number;
  intelligence: number;
  armor: number;
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
  sources: {
    base: ProgressionStatVector;
    automaticProgression: ProgressionStatVector;
    milestoneChoices: ProgressionStatVector;
    legacyAdjustment: ProgressionStatVector;
    equipment: ProgressionStatVector;
    temporary: ProgressionStatVector;
  };
  effective: ProgressionStatVector;
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
