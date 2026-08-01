import type { CharacterClass } from '../../../common/domain/game.types.js';
import type {
  MilestoneKey,
  ProgressionStatVector,
  SoftCapDefinition,
} from './character-progression.rules.js';

export interface ProgressionSourceBreakdown {
  base: ProgressionStatVector;
  levels: ProgressionStatVector;
  milestones: ProgressionStatVector;
  equipment: ProgressionStatVector;
  permanent: ProgressionStatVector;
  temporary: ProgressionStatVector;
  legacyAdjustment: ProgressionStatVector;
}

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
  current: {
    hp: number;
    energy: number;
    silver: number;
  };
  points: {
    earned: number;
    spent: number;
    available: number;
  };
  sources: ProgressionSourceBreakdown;
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
  softCaps: readonly SoftCapDefinition[];
  milestones: MilestoneOptionSnapshot[];
  respec: {
    freeAvailable: boolean;
    costSilver: number;
  };
}

export interface ProgressionMigrationStatus {
  rulesVersion: number;
  totalCharacters: number;
  migratedCharacters: number;
  pendingCharacters: number;
  rollbackAvailable: number;
}

export interface ProgressionMigrationResult {
  dryRun: boolean;
  processed: number;
  changed: number;
  characterIds: string[];
}
