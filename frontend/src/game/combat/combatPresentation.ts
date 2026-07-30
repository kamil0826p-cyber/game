import '../../contracts/groupCombat';
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

export interface CombatTeamView {
  own: CombatParticipantPayload;
  allies: CombatParticipantPayload[];
  enemies: CombatParticipantPayload[];
  ownTeamId: string;
  enemyTeamId: string;
}

export function isSelfCastCombatAction(action: CombatActionResolutionPayload | undefined): boolean {
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
  const animationKey = typeof actionOrAnimationKey === 'string'
    ? actionOrAnimationKey
    : actionOrAnimationKey.animationKey;
  const key = animationKey.toLowerCase();
  if (key.includes('fire') || key.includes('flame') || key.includes('ember') || key.includes('meteor')) return 'fire';
  if (key.includes('frost') || key.includes('ice')) return 'frost';
  if (key.includes('arcane') || key.includes('time') || key.includes('cataclysm')) return 'arcane';
  if (key.includes('arrow') || key.includes('shot') || key.includes('hunt') || key.includes('volley')) return 'projectile';
  if (key.includes('status') || key.includes('stunned') || key.includes('start')) return 'status';
  return 'physical';
}

function withMobRenderScale(participant: CombatParticipantPayload): CombatParticipantPayload {
  if (participant.kind !== 'MOB' || participant.renderScale !== undefined) return participant;
  const mob = Object.values(mobStore.getSnapshot()).find((candidate) => candidate.outfitKey === participant.outfitKey);
  return mob ? { ...participant, renderScale: mob.renderScale } : participant;
}

export function combatTeams(
  combat: CombatSnapshot,
  ownCharacterId: string,
): CombatTeamView | undefined {
  const participants = combat.participants.map(withMobRenderScale);
  const own = participants.find((participant) => participant.characterId === ownCharacterId);
  if (!own) return undefined;
  const ownTeamId = own.teamId ?? combat.teams?.find((team) => team.actorIds.includes(own.actorId))?.teamId;
  if (!ownTeamId) {
    const opponent = participants.find((participant) => participant.actorId !== own.actorId);
    return opponent
      ? { own, allies: [own], enemies: [opponent], ownTeamId: 'legacy-own', enemyTeamId: 'legacy-enemy' }
      : undefined;
  }
  const ownTeam = combat.teams?.find((team) => team.teamId === ownTeamId);
  const enemyTeam = combat.teams?.find((team) => team.teamId !== ownTeamId);
  const allies = participants.filter((participant) => participant.teamId === ownTeamId || ownTeam?.actorIds.includes(participant.actorId));
  const enemies = participants.filter((participant) => participant.teamId !== ownTeamId && (enemyTeam ? enemyTeam.actorIds.includes(participant.actorId) : true));
  if (!enemyTeam || enemies.length === 0) return undefined;
  return { own, allies, enemies, ownTeamId, enemyTeamId: enemyTeam.teamId };
}

export function combatSides(
  combat: CombatSnapshot,
  ownCharacterId: string,
): { own: CombatParticipantPayload; opponent: CombatParticipantPayload } | undefined {
  const teams = combatTeams(combat, ownCharacterId);
  const opponent = teams?.enemies[0];
  return teams && opponent ? { own: teams.own, opponent } : undefined;
}

export function isCombatantAlive(participant: CombatParticipantPayload): boolean {
  return participant.hp > 0 && !participant.withdrawn;
}

export function selectCombatTarget(
  enemies: readonly CombatParticipantPayload[],
  currentActorId?: string,
): CombatParticipantPayload | undefined {
  const current = enemies.find((participant) => participant.actorId === currentActorId && isCombatantAlive(participant));
  return current ?? enemies.find(isCombatantAlive);
}

export function combatRosterColumns(memberCount: number): 1 | 2 {
  return memberCount > 5 ? 2 : 1;
}

export function actionDamageFor(action: CombatActionResolutionPayload, actorId: string): number {
  return action.results
    .filter((result) => result.targetActorId === actorId)
    .reduce((total, result) => total + Math.min(0, result.hpDelta), 0);
}
