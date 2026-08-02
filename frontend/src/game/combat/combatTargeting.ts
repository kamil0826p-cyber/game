import type { CombatLegalActionPayload } from '../../contracts/tacticalCombat';

const IMPLICIT_TARGETING = new Set<CombatLegalActionPayload['targeting']>([
  'SELF',
  'ALL_ALLIES',
  'ALL_ENEMIES',
  'FRONT_ROW',
  'BACK_ROW',
]);

export type CombatTargetResolution =
  | { ready: true; targetActorId?: string }
  | { ready: false };

export function resolveCombatActionTarget(
  action: CombatLegalActionPayload,
  selectedTargetId: string | undefined,
): CombatTargetResolution {
  if (action.targetActorIds.length === 0) return { ready: false };

  if (selectedTargetId) {
    if (action.targetActorIds.includes(selectedTargetId)) {
      return { ready: true, targetActorId: selectedTargetId };
    }
    if (!IMPLICIT_TARGETING.has(action.targeting)) return { ready: false };
  }

  if (IMPLICIT_TARGETING.has(action.targeting) || action.targetActorIds.length === 1) {
    return { ready: true, targetActorId: action.targetActorIds[0] };
  }

  return { ready: false };
}

export function isCombatActionTargetReady(
  action: CombatLegalActionPayload | undefined,
  selectedTargetId: string | undefined,
): boolean {
  return Boolean(action && resolveCombatActionTarget(action, selectedTargetId).ready);
}
