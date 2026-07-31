import { isActorWithinInteractionRange } from '../../common/rules/actor-interaction.js';

const integerFromEnvironment = (
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  const raw = process.env[name];
  const parsed = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
};

export const COMBAT_TURN_TTL_MS = integerFromEnvironment(
  'COMBAT_TURN_TIMEOUT_MS',
  12_000,
  3000,
  60_000,
);
export const COMBAT_EVENT_HISTORY_LIMIT = 48;
export const COMBAT_RESULT_RETENTION_MS = 15_000;
export const COMBAT_TEAM_LIMIT = integerFromEnvironment('COMBAT_MAX_TEAM_SIZE', 5, 1, 10);
export const COMBAT_DEFAULT_TIMEOUT_ACTION = 'BASIC_ATTACK' as const;

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
  return 100 / (100 + effectiveArmor);
}

export function magicalDamageMultiplier(armor: number): number {
  return 100 / (100 + Math.max(0, armor) * 0.35);
}
