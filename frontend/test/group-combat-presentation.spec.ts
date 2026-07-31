import { describe, expect, it } from 'vitest';
import type { CombatParticipantPayload, CombatSnapshot } from '../src/contracts/socket';
import {
  combatEffectPointForActor,
  combatFormationSlots,
  combatRosterColumns,
  combatTeams,
  selectCombatTarget,
} from '../src/game/combat/combatPresentation';

const participant = (
  actorId: string,
  teamId: string,
  hp = 100,
  overrides: Partial<CombatParticipantPayload> = {},
): CombatParticipantPayload => ({
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
  ...overrides,
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
    {
      teamId: 'a',
      anchorActorId: participants[0]!.actorId,
      actorIds: participants.filter((item) => item.teamId === 'a').map((item) => item.actorId),
    },
    {
      teamId: 'b',
      anchorActorId: participants.at(-1)!.actorId,
      actorIds: participants.filter((item) => item.teamId === 'b').map((item) => item.actorId),
    },
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

  it('anchors ten combatants to the two rows painted into the arena', () => {
    const left = combatFormationSlots(10, 'left');
    const right = combatFormationSlots(10, 'right');

    expect(left).toHaveLength(10);
    expect(right).toHaveLength(10);
    expect(left.every((slot) => slot.x < 50 && slot.effectX < 50)).toBe(true);
    expect(right.every((slot) => slot.x > 50 && slot.effectX > 50)).toBe(true);
    expect(new Set(left.map((slot) => `${slot.x}:${slot.y}`)).size).toBe(10);
    expect(new Set(right.map((slot) => `${slot.x}:${slot.y}`)).size).toBe(10);
    expect(left.slice(0, 5).every((slot) => slot.row === 'front')).toBe(true);
    expect(left.slice(5).every((slot) => slot.row === 'back')).toBe(true);
    expect(left.every((slot) => slot.effectY < slot.y)).toBe(true);
    expect(right.every((slot, index) => slot.x === 100 - left[index]!.x)).toBe(true);
    expect(right.every((slot, index) => slot.effectX === 100 - left[index]!.effectX)).toBe(true);
  });

  it('uses a large central slot for solo combat and compact slots for full parties', () => {
    const solo = combatFormationSlots(1, 'left');
    const group = combatFormationSlots(10, 'right');

    expect(solo).toHaveLength(1);
    expect(group).toHaveLength(10);
    expect(solo[0]).toMatchObject({ row: 'front', x: 21.4, scale: 1.08 });
    expect(group.every((slot) => slot.x > 50)).toBe(true);
    expect(group.slice(0, 5).every((slot) => slot.scale === 0.7)).toBe(true);
    expect(group.slice(5).every((slot) => slot.scale <= 0.72)).toBe(true);
  });

  it('moves combat effects down with a scaled-down mob sprite', () => {
    const mobActorId = 'mob:small-rabbit';
    const combat = snapshot([
      participant('self', 'a'),
      participant(mobActorId, 'b', 100, {
        kind: 'MOB',
        outfitKey: 'mob-rabbit-spawn',
        renderScale: 0.5,
      }),
    ]);
    const slot = combatFormationSlots(1, 'right')[0]!;

    combatTeams(combat, 'self');
    const point = combatEffectPointForActor(slot, mobActorId);

    expect(point.x).toBe(slot.effectX);
    expect(point.y).toBeCloseTo(slot.y - (slot.y - slot.effectY) * 0.5);
    expect(point.y).toBeGreaterThan(slot.effectY);
  });

  it('keeps a living selected target and falls back after defeat', () => {
    const enemies = [participant('enemy-a', 'b', 0), participant('enemy-b', 'b', 50)];
    expect(selectCombatTarget(enemies, 'enemy-a')?.actorId).toBe('enemy-b');
    expect(selectCombatTarget(enemies, 'enemy-b')?.actorId).toBe('enemy-b');
  });
});
