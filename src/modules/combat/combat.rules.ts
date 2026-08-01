import { isActorWithinInteractionRange } from '../../common/rules/actor-interaction.js';
import { armorDamageMultiplier } from '../characters/progression/character-progression.rules.js';

export const COMBAT_EVENT_HISTORY_LIMIT = 96;
export const COMBAT_RESULT_RETENTION_MS = 15_000;
export const COMBAT_TEAM_LIMIT = 10;
export const COMBAT_FORMATION_FRONT_SLOTS = 5;
export const COMBAT_FORMATION_TOTAL_SLOTS = 10;
export const COMBAT_DISCONNECT_GRACE_MS = 60_000;
export const COMBAT_TURN_TTL_MS = 10_000;
export const COMBAT_REACTION_TTL_MS = 12_000;

export interface CombatTimingPolicy {
  key: 'STANDARD' | 'TUTORIAL';
  decisionMs: number;
  reactionMs: number;
  disconnectedFallbackMs: number;
  presentationGraceMs: number;
}

export const STANDARD_COMBAT_TIMING: CombatTimingPolicy = Object.freeze({
  key: 'STANDARD',
  decisionMs: COMBAT_TURN_TTL_MS,
  reactionMs: COMBAT_REACTION_TTL_MS,
  disconnectedFallbackMs: 2_000,
  presentationGraceMs: 750,
});

export const TUTORIAL_COMBAT_TIMING: CombatTimingPolicy = Object.freeze({
  key: 'TUTORIAL',
  decisionMs: 30_000,
  reactionMs: 18_000,
  disconnectedFallbackMs: 5_000,
  presentationGraceMs: 1_000,
});

export interface CombatPosition {
  mapId: string;
  x: number;
  y: number;
}

export function isCombatDistanceAllowed(first: CombatPosition, second: CombatPosition): boolean {
  return isActorWithinInteractionRange(first, second);
}

export function combatActorLockKeys(actorIds: Iterable<string> | string, secondActorId?: string): string[] {
  const ids = typeof actorIds === 'string' ? [actorIds, ...(secondActorId ? [secondActorId] : [])] : [...actorIds];
  return [...new Set(ids)].sort().map((actorId) => `combat-actor:${actorId}`);
}

export function physicalDamageMultiplier(armor: number, armorPenetration = 0): number {
  const penetration = Math.min(0.9, Math.max(0, armorPenetration));
  const effectiveArmor = Math.max(0, armor) * (1 - penetration);
  return armorDamageMultiplier(effectiveArmor);
}

export function magicalDamageMultiplier(magicResistance: number): number {
  return armorDamageMultiplier(Math.max(0, magicResistance));
}

export function formationLineForSlot(slot: number): 'FRONT' | 'BACK' {
  return slot < COMBAT_FORMATION_FRONT_SLOTS ? 'FRONT' : 'BACK';
}

export function deterministicFormationSlots(memberCount: number): number[] {
  const count = Math.max(0, Math.min(COMBAT_FORMATION_TOTAL_SLOTS, Math.trunc(memberCount)));
  return Array.from({ length: count }, (_, index) => index);
}

export function adjacentFormationSlots(slot: number): number[] {
  const rowStart = slot < COMBAT_FORMATION_FRONT_SLOTS ? 0 : COMBAT_FORMATION_FRONT_SLOTS;
  const rowEnd = rowStart + COMBAT_FORMATION_FRONT_SLOTS - 1;
  return [slot - 1, slot + 1].filter((candidate) => candidate >= rowStart && candidate <= rowEnd);
}

export function controlDurationMultiplier(stacks: number): number {
  return [1, 0.5, 0.25, 0][Math.max(0, Math.min(3, Math.trunc(stacks)))] ?? 0;
}

export function decisionPercentile(values: readonly number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentile) - 1));
  return sorted[index] ?? 0;
}
