import { isActorWithinInteractionRange } from '../../common/rules/actor-interaction.js';
import type {
  CombatFallbackPolicy,
  CombatFormationLine,
  CombatTurnPolicyPayload,
} from '../../contracts/tactical-combat.events.js';
import { applyArmorDiminishingReturns } from '../progression/character-stats.js';

function integerFromEnvironment(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export const COMBAT_TEAM_LIMIT = 10;
export const COMBAT_FRONT_ROW_SIZE = 5;
export const COMBAT_EVENT_HISTORY_LIMIT = 96;
export const COMBAT_RESULT_RETENTION_MS = 15_000;
export const COMBAT_OPERATION_HISTORY_LIMIT = 128;
export const COMBAT_CONTROL_DR_RESET_TURNS = 8;

export const COMBAT_TURN_POLICY: Readonly<CombatTurnPolicyPayload> = Object.freeze({
  decisionMs: integerFromEnvironment('COMBAT_TURN_TIMEOUT_MS', 10_000, 3_000, 60_000),
  reactionMs: integerFromEnvironment('COMBAT_REACTION_TIMEOUT_MS', 4_000, 1_000, 15_000),
  tutorialDecisionMs: integerFromEnvironment(
    'COMBAT_TUTORIAL_TURN_TIMEOUT_MS',
    15_000,
    5_000,
    90_000,
  ),
});

// Backwards-compatible export for services that schedule the active turn.
export const COMBAT_TURN_TTL_MS = COMBAT_TURN_POLICY.decisionMs;

export interface CombatPosition {
  mapId: string;
  x: number;
  y: number;
}

export function isCombatDistanceAllowed(first: CombatPosition, second: CombatPosition): boolean {
  return isActorWithinInteractionRange(first, second);
}

export function combatActorLockKeys(
  actorIds: Iterable<string> | string,
  secondActorId?: string,
): string[] {
  const ids =
    typeof actorIds === 'string'
      ? [actorIds, ...(secondActorId ? [secondActorId] : [])]
      : [...actorIds];
  return [...new Set(ids)].sort().map((actorId) => `combat-actor:${actorId}`);
}

export function formationLineForSlot(slot: number): CombatFormationLine {
  if (!Number.isInteger(slot) || slot < 0 || slot >= COMBAT_TEAM_LIMIT) {
    throw new Error('COMBAT_FORMATION_INVALID');
  }
  return slot < COMBAT_FRONT_ROW_SIZE ? 'FRONT' : 'BACK';
}

export function deterministicFormationSlots(actorCount: number): number[] {
  if (!Number.isInteger(actorCount) || actorCount < 1 || actorCount > COMBAT_TEAM_LIMIT) {
    throw new Error('COMBAT_FORMATION_INVALID');
  }
  const frontCount = Math.min(COMBAT_FRONT_ROW_SIZE, Math.ceil(actorCount / 2));
  const backCount = actorCount - frontCount;
  return [
    ...Array.from({ length: frontCount }, (_, index) => index),
    ...Array.from({ length: backCount }, (_, index) => COMBAT_FRONT_ROW_SIZE + index),
  ];
}

export function defaultFallbackPolicy(kind: 'PLAYER' | 'MOB'): CombatFallbackPolicy {
  return kind === 'PLAYER' ? 'GUARD' : 'BASIC_ATTACK';
}

export function physicalDamageMultiplier(armor: number, armorPenetration = 0): number {
  const penetration = Math.min(0.9, Math.max(0, armorPenetration));
  const effectiveArmor = applyArmorDiminishingReturns(armor) * (1 - penetration);
  return 100 / (100 + effectiveArmor);
}

export function magicalDamageMultiplier(armor: number): number {
  return 100 / (100 + applyArmorDiminishingReturns(armor) * 0.35);
}

export function percentile(values: readonly number[], percentileRank: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(0, Math.min(1, percentileRank));
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * rank) - 1);
  return sorted[Math.max(0, index)]!;
}
