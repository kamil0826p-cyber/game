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
  scale: number;
  layer: number;
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

function rowScale(rowCount: number, backRow: boolean): number {
  const base = rowCount <= 1 ? 1 : rowCount === 2 ? 0.94 : rowCount === 3 ? 0.86 : 0.76;
  return backRow ? Math.max(0.62, base - 0.1) : base;
}

function formationRow(
  rowCount: number,
  startIndex: number,
  side: 'left' | 'right',
  y: number,
  backRow: boolean,
): Array<{ index: number; slot: CombatStagePosition }> {
  if (rowCount <= 0) return [];
  const center = 29;
  const spread = rowCount === 1 ? 0 : Math.min(30, (rowCount - 1) * 7.75);
  const step = rowCount === 1 ? 0 : spread / (rowCount - 1);
  const scale = rowScale(rowCount, backRow);
  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const leftX = center - spread / 2 + step * rowIndex;
    const x = side === 'left' ? leftX : 100 - leftX;
    const distanceFromCenter = Math.abs(rowIndex - (rowCount - 1) / 2);
    return {
      index: startIndex + rowIndex,
      slot: {
        x,
        y: y + distanceFromCenter * 1.35,
        scale,
        layer: (backRow ? 10 : 30) + rowIndex,
      },
    };
  });
}

export function combatFormationSlots(
  memberCount: number,
  side: 'left' | 'right',
): CombatStagePosition[] {
  const count = Math.max(0, Math.min(10, Math.trunc(memberCount)));
  if (count === 0) return [];
  const backCount = count > 5 ? count - 5 : 0;
  const frontCount = count > 5 ? 5 : count;
  const rows = [
    ...formationRow(backCount, 5, side, 36, true),
    ...formationRow(frontCount, 0, side, count > 5 ? 59 : 53, false),
  ];
  const slots = new Array<CombatStagePosition>(count);
  for (const row of rows) slots[row.index] = row.slot;
  return slots;
}

export function actionDamageFor(action: CombatActionResolutionPayload, actorId: string): number {
  return action.results
    .filter((result) => result.targetActorId === actorId)
    .reduce((total, result) => total + Math.min(0, result.hpDelta), 0);
}
