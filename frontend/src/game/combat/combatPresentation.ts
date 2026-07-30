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

export interface CombatStagePosition {
  x: number;
  y: number;
  effectX: number;
  effectY: number;
  scale: number;
  layer: number;
  row: 'front' | 'back';
}

interface ArenaAnchor {
  x: number;
  y: number;
  effectY: number;
  layer: number;
}

const FRONT_LEFT_ANCHORS: readonly ArenaAnchor[] = [
  { x: 21.4, y: 74.7, effectY: 61.5, layer: 55 },
  { x: 15.6, y: 77, effectY: 63, layer: 54 },
  { x: 27.1, y: 77, effectY: 63, layer: 56 },
  { x: 9.9, y: 81.6, effectY: 66, layer: 53 },
  { x: 32.8, y: 81.6, effectY: 66, layer: 57 },
];

const BACK_LEFT_ANCHORS: readonly ArenaAnchor[] = [
  { x: 18.5, y: 50.8, effectY: 40, layer: 25 },
  { x: 13.5, y: 52.8, effectY: 42, layer: 24 },
  { x: 23.4, y: 52.8, effectY: 42, layer: 26 },
  { x: 8.6, y: 56.4, effectY: 45, layer: 23 },
  { x: 28.4, y: 56.4, effectY: 45, layer: 27 },
];

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

function frontScale(memberCount: number): number {
  if (memberCount <= 1) return 1.08;
  if (memberCount === 2) return 1;
  if (memberCount === 3) return 0.91;
  if (memberCount === 4) return 0.83;
  if (memberCount === 5) return 0.77;
  return 0.7;
}

function backScale(backCount: number): number {
  if (backCount <= 1) return 0.72;
  if (backCount === 2) return 0.68;
  if (backCount === 3) return 0.65;
  return 0.61;
}

function mirrorAnchor(anchor: ArenaAnchor, side: 'left' | 'right'): ArenaAnchor {
  return side === 'left' ? anchor : { ...anchor, x: 100 - anchor.x };
}

function toStagePosition(
  anchor: ArenaAnchor,
  side: 'left' | 'right',
  row: 'front' | 'back',
  scale: number,
): CombatStagePosition {
  const resolved = mirrorAnchor(anchor, side);
  return {
    x: resolved.x,
    y: resolved.y,
    effectX: resolved.x,
    effectY: resolved.effectY,
    scale,
    layer: resolved.layer,
    row,
  };
}

export function combatFormationSlots(
  memberCount: number,
  side: 'left' | 'right',
): CombatStagePosition[] {
  const count = Math.max(0, Math.min(10, Math.trunc(memberCount)));
  if (count === 0) return [];

  const frontCount = Math.min(5, count);
  const backCount = Math.max(0, count - frontCount);
  const slots = FRONT_LEFT_ANCHORS
    .slice(0, frontCount)
    .map((anchor) => toStagePosition(anchor, side, 'front', frontScale(count)));
  slots.push(
    ...BACK_LEFT_ANCHORS
      .slice(0, backCount)
      .map((anchor) => toStagePosition(anchor, side, 'back', backScale(backCount))),
  );
  return slots;
}

export function actionDamageFor(action: CombatActionResolutionPayload, actorId: string): number {
  return action.results
    .filter((result) => result.targetActorId === actorId)
    .reduce((total, result) => total + Math.min(0, result.hpDelta), 0);
}
