import type { CharacterClass } from '../../common/domain/game.types.js';
import type { CombatTelegraphCounter } from '../../contracts/tactical-combat.events.js';

export type SkillTargeting =
  | 'SELF'
  | 'ALLY'
  | 'ENEMY'
  | 'AREA'
  | 'ALL_ALLIES'
  | 'ALL_ENEMIES'
  | 'FRONT_ROW'
  | 'BACK_ROW'
  | 'ADJACENT';
export type SkillUnlockState =
  'UNLOCKED' | 'AVAILABLE' | 'LOCKED_LEVEL' | 'LOCKED_PREREQUISITE' | 'LOCKED_POINTS';

export type SkillScalingStat = 'STRENGTH' | 'AGILITY' | 'INTELLIGENCE' | 'MAX_HP';
export type SkillDamageType = 'PHYSICAL' | 'ARCANE' | 'FIRE' | 'FROST';

export type CombatEffectOperation =
  | {
      type: 'DAMAGE';
      scaling: SkillScalingStat;
      coefficient: number;
      damageType: SkillDamageType;
      armorPenetration?: number;
      targetHpBelow?: number;
      bonusCoefficient?: number;
      consumesStatusKey?: string;
    }
  | {
      type: 'APPLY_STATUS';
      statusKey: string;
      durationTurns: number;
      magnitude?: number;
      chance?: number;
      harmful?: boolean;
      hardControl?: boolean;
    }
  | {
      type: 'HEAL';
      scaling: SkillScalingStat;
      coefficient: number;
    }
  | {
      type: 'SHIELD';
      scaling: SkillScalingStat;
      coefficient: number;
      durationTurns: number;
    }
  | {
      type: 'CLEANSE';
      maximumStatuses?: number;
    }
  | {
      type: 'ENERGY_TRANSFER';
      amount: number;
    };

export interface SkillVisualDefinition {
  castEffectKey: string;
  projectileEffectKey?: string;
  impactEffectKey: string;
  accentColor: string;
  travelMs?: number;
}

export interface SkillTelegraphDefinition {
  reactionWindowMs: number;
  publicIntent: string;
  interruptible: boolean;
  counters: readonly CombatTelegraphCounter[];
}

export interface SkillCatalogDefinition {
  key: string;
  name: string;
  description: string;
  characterClass: CharacterClass;
  minimumLevel: number;
  energyCost: number;
  cooldownTurns: number;
  targeting: SkillTargeting;
  maxRank: 1;
  displayOrder: number;
  treeRow: number;
  treeColumn: -1 | 0 | 1;
  icon: string;
  prerequisiteKeys: readonly string[];
  effects: readonly CombatEffectOperation[];
  animationKey: string;
  visual: SkillVisualDefinition;
  telegraph?: SkillTelegraphDefinition;
}

export interface SkillDefinitionPayload {
  key: string;
  name: string;
  description: string;
  characterClass: CharacterClass;
  minimumLevel: number;
  energyCost: number;
  cooldownTurns: number;
  targeting: SkillTargeting;
  maxRank: number;
  displayOrder: number;
  treeRow: number;
  treeColumn: number;
  icon: string;
  prerequisiteKeys: string[];
  effects: CombatEffectOperation[];
  animationKey: string;
  visual: SkillVisualDefinition;
  telegraph?: SkillTelegraphDefinition;
  rank: number;
  cooldownTurnsRemaining: number;
  unlockState: SkillUnlockState;
  missingPrerequisiteKeys: string[];
}

export interface SkillPointSummary {
  earned: number;
  spent: number;
  available: number;
  nextPointAtLevel?: number;
}

export interface SkillTreeSnapshot {
  characterClass: CharacterClass;
  characterLevel: number;
  points: SkillPointSummary;
  skills: SkillDefinitionPayload[];
}
