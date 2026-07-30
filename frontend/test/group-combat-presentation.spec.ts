import { describe, expect, it } from 'vitest';
import type { CombatParticipantPayload, CombatSnapshot } from '../src/contracts/socket';
import {
  combatRosterColumns,
  combatTeams,
  selectCombatTarget,
} from '../src/game/combat/combatPresentation';

const participant = (actorId: string, teamId: string, hp = 100): CombatParticipantPayload => ({
  actorId,
  teamId,
  withdrawn: false,
  kind: 'PLAYER',
  characterId: actorId,
  name: actorId,
  characterClass: 'MAGE',
  level: 20,
  outfitKey: 'mage-apprentice',
  hp,
  maxHp: 100,
  energy: 50,
  maxEnergy: 50,
  shield: 0,
  statuses: [],
  skills: [],
});

const snapshot = (participants: CombatParticipantPayload[]): CombatSnapshot => ({
  combatId: '00000000-0000-4000-8000-000000000001',
  status: 'ACTIVE',
  zoneType: 'PVP',
  mapId: 'map-a',
  createdAt: 1,
  startedAt: 1,
  turnNumber: 1,
  initiatorActorId: participants[0]!.actorId,
  recipientActorId: participants.at(-1)!.actorId,
  teams: [
    { teamId: 'a', anchorActorId: participants[0]!.actorId, actorIds: participants.filter((item) => item.teamId === 'a').map((item) => item.actorId) },
    { teamId: 'b', anchorActorId: participants.at(-1)!.actorId, actorIds: participants.filter((item) => item.teamId === 'b').map((item) => item.actorId) },
  ],
  participants: participants as unknown as [CombatParticipantPayload, CombatParticipantPayload],
  recentActions: [],
});

describe('group combat presentation', () => {
  it('splits the snapshot into the local team and enemies', () => {
    const combat = snapshot([
      participant('self', 'a'),
      participant('ally', 'a'),
      participant('enemy-a', 'b'),
      participant('enemy-b', 'b'),
    ]);
    const view = combatTeams(combat, 'self');
    expect(view?.allies.map((item) => item.actorId)).toEqual(['self', 'ally']);
    expect(view?.enemies.map((item) => item.actorId)).toEqual(['enemy-a', 'enemy-b']);
  });

  it('keeps ten members readable by switching to two roster columns', () => {
    expect(combatRosterColumns(5)).toBe(1);
    expect(combatRosterColumns(6)).toBe(2);
    expect(combatRosterColumns(10)).toBe(2);
  });

  it('keeps a living selected target and falls back after defeat', () => {
    const enemies = [participant('enemy-a', 'b', 0), participant('enemy-b', 'b', 50)];
    expect(selectCombatTarget(enemies, 'enemy-a')?.actorId).toBe('enemy-b');
    expect(selectCombatTarget(enemies, 'enemy-b')?.actorId).toBe('enemy-b');
  });
});
