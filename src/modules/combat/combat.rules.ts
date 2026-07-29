import { isActorWithinInteractionRange } from '../../common/rules/actor-interaction.js';

export const COMBAT_TURN_TTL_MS = 30_000;
export const COMBAT_EVENT_HISTORY_LIMIT = 24;
export const COMBAT_RESULT_RETENTION_MS = 15_000;

export interface CombatPosition {
  mapId: string;
  x: number;
  y: number;
}

export function isCombatDistanceAllowed(first: CombatPosition, second: CombatPosition): boolean {
  return isActorWithinInteractionRange(first, second);
}

export function combatActorLockKeys(firstActorId: string, secondActorId: string): string[] {
  return [firstActorId, secondActorId].sort().map((actorId) => `combat-actor:${actorId}`);
}

export function physicalDamageMultiplier(armor: number, armorPenetration = 0): number {
  const penetration = Math.min(0.9, Math.max(0, armorPenetration));
  const effectiveArmor = Math.max(0, armor) * (1 - penetration);
  return 100 / (100 + effectiveArmor);
}

export function magicalDamageMultiplier(armor: number): number {
  return 100 / (100 + Math.max(0, armor) * 0.35);
}
