import type { CombatActionCommand, CombatRuntimeActor } from '../combat/combat.types.js';

export type MobAiTargetPolicy =
  | 'LOWEST_HP_RATIO'
  | 'HIGHEST_HP_RATIO'
  | 'LOWEST_ARMOR'
  | 'RANDOM_ENEMY'
  | 'SELF';

export interface MobAiActionCondition {
  actorHpBelow?: number;
  actorHpAbove?: number;
  targetHpBelow?: number;
  turnAtLeast?: number;
  requiredStatus?: string;
  forbiddenStatus?: string;
}

export interface MobTelegraphDefinition {
  key: string;
  resolveAfterTurns: number;
  counterKinds: readonly ('INTERRUPT' | 'GUARD' | 'CLEANSE' | 'POSITION')[];
  publicMetadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface MobAiActionDefinition {
  action: CombatActionCommand['action'];
  skillKey?: string;
  target: MobAiTargetPolicy;
  priority: number;
  weight: number;
  condition?: MobAiActionCondition;
  telegraph?: MobTelegraphDefinition;
}

export interface MobAiPhaseDefinition {
  key: string;
  startsAtHpRatio: number;
  actions: readonly MobAiActionDefinition[];
}

export interface MobAiProfile {
  version: 1;
  phases: readonly MobAiPhaseDefinition[];
}

export interface MobAiContext {
  actor: CombatRuntimeActor;
  allies: readonly CombatRuntimeActor[];
  enemies: readonly CombatRuntimeActor[];
  turnNumber: number;
}

export interface PlannedMobAction {
  command: CombatActionCommand;
  phaseKey: string;
  telegraph?: MobTelegraphDefinition;
}

export interface ActiveCombatTelegraph {
  id: string;
  key: string;
  actorId: string;
  targetActorId?: string;
  skillKey?: string;
  createdTurn: number;
  resolvesOnTurn: number;
  counterKinds: readonly ('INTERRUPT' | 'GUARD' | 'CLEANSE' | 'POSITION')[];
  publicMetadata: Readonly<Record<string, string | number | boolean>>;
}
