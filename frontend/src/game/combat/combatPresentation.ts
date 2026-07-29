import type {
  CombatActionResolutionPayload,
  CombatParticipantPayload,
  CombatSnapshot,
} from '../../contracts/socket';

export type CombatVfxFamily =
  'arcane' | 'fire' | 'frost' | 'physical' | 'projectile' | 'status';

export function getCombatVfxFamily(animationKey: string): CombatVfxFamily {
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
  return own && opponent ? { own, opponent } : undefined;
}

export function actionDamageFor(
  action: CombatActionResolutionPayload,
  actorId: string,
): number {
  return action.results
    .filter((result) => result.targetActorId === actorId)
    .reduce((total, result) => total + Math.min(0, result.hpDelta), 0);
}
