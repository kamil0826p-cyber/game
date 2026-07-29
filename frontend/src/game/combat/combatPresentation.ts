import type {
  CombatActionResolutionPayload,
  CombatParticipantPayload,
  CombatSnapshot,
} from '../../contracts/socket';
import { mobStore } from '../state/mobStore';

export type CombatVfxFamily =
  | 'arcane'
  | 'fire'
  | 'frost'
  | 'physical'
  | 'projectile'
  | 'status'
  | 'support';

export function isSelfCastCombatAction(
  action: CombatActionResolutionPayload | undefined,
): boolean {
  return Boolean(
    action &&
      action.action === 'SKILL' &&
      action.targetActorId === action.actorId &&
      action.results.every((result) => result.targetActorId === action.actorId),
  );
}

export function usesAttackMotion(action: CombatActionResolutionPayload | undefined): boolean {
  if (!action) return false;
  if (action.action === 'BASIC_ATTACK') return true;
  return action.action === 'SKILL' && !isSelfCastCombatAction(action);
}

export function getCombatVfxFamily(
  actionOrAnimationKey: CombatActionResolutionPayload | string,
): CombatVfxFamily {
  if (typeof actionOrAnimationKey !== 'string' && isSelfCastCombatAction(actionOrAnimationKey)) {
    return 'support';
  }

  const animationKey =
    typeof actionOrAnimationKey === 'string'
      ? actionOrAnimationKey
      : actionOrAnimationKey.animationKey;
  const key = animationKey.toLowerCase();
  if (
    key.includes('fire') ||
    key.includes('flame') ||
    key.includes('ember') ||
    key.includes('meteor')
  )
    return 'fire';
  if (key.includes('frost') || key.includes('ice')) return 'frost';
  if (key.includes('arcane') || key.includes('time') || key.includes('cataclysm'))
    return 'arcane';
  if (
    key.includes('arrow') ||
    key.includes('shot') ||
    key.includes('hunt') ||
    key.includes('volley')
  )
    return 'projectile';
  if (key.includes('status') || key.includes('stunned') || key.includes('start'))
    return 'status';
  return 'physical';
}

function withMobRenderScale(participant: CombatParticipantPayload): CombatParticipantPayload {
  if (participant.kind !== 'MOB' || participant.renderScale !== undefined) return participant;
  const mob = Object.values(mobStore.getSnapshot()).find(
    (candidate) => candidate.outfitKey === participant.outfitKey,
  );
  return mob ? { ...participant, renderScale: mob.renderScale } : participant;
}

export function combatSides(
  combat: CombatSnapshot,
  ownCharacterId: string,
): { own: CombatParticipantPayload; opponent: CombatParticipantPayload } | undefined {
  const own = combat.participants.find(
    (participant) => participant.characterId === ownCharacterId,
  );
  const opponent = combat.participants.find(
    (participant) => participant.characterId !== ownCharacterId,
  );
  return own && opponent
    ? { own: withMobRenderScale(own), opponent: withMobRenderScale(opponent) }
    : undefined;
}

export function actionDamageFor(
  action: CombatActionResolutionPayload,
  actorId: string,
): number {
  return action.results
    .filter((result) => result.targetActorId === actorId)
    .reduce((total, result) => total + Math.min(0, result.hpDelta), 0);
}
