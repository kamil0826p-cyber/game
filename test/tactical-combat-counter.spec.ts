import { describe, expect, it } from 'vitest';
import { CombatEngine } from '../src/modules/combat/combat.engine.js';
import type {
  CombatActorInput,
  CombatRuntime,
  CombatTeamInput,
} from '../src/modules/combat/combat.types.js';

const actor = (
  actorId: string,
  overrides: Partial<CombatActorInput> = {},
): CombatActorInput => ({
  actorId,
  characterId: actorId,
  kind: 'PLAYER',
  name: actorId,
  characterClass: 'WARRIOR',
  level: 20,
  outfitKey: 'warrior',
  hp: 200,
  maxHp: 200,
  energy: 100,
  maxEnergy: 100,
  strength: 30,
  agility: actorId === 'first' ? 50 : 10,
  intelligence: 10,
  armor: 15,
  skills: [],
  ...overrides,
});

const team = (anchorActorId: string, actors: CombatActorInput[]): CombatTeamInput => ({
  anchorActorId,
  actors,
});

const activeCombat = (
  firstTeam = [actor('first')],
  secondTeam = [actor('second')],
  zoneType: CombatRuntime['zoneType'] = 'PVP',
) => {
  const engine = new CombatEngine(() => 0.5);
  const runtime = engine.createRequest(
    '00000000-0000-4000-8000-000000000111',
    zoneType,
    'map-a',
    team(firstTeam[0]!.actorId, firstTeam),
    team(secondTeam[0]!.actorId, secondTeam),
    1_000,
    2_000,
  );
  engine.start(runtime, 1_000);
  return { engine, runtime };
};

describe('tactical combat counter victory resolution', () => {
  it('awards victory to the surviving countering team when recoil defeats the attacker', () => {
    const { engine, runtime } = activeCombat(
      [actor('first', { hp: 1, maxHp: 1 })],
      [actor('second')],
    );
    engine.act(runtime, 'first', { action: 'SKIP' }, 1_100);
    engine.act(runtime, 'second', { action: 'COUNTER' }, 1_200);

    const snapshot = engine.act(
      runtime,
      'first',
      { action: 'BASIC_ATTACK', targetActorId: 'second' },
      1_300,
    );
    const secondTeamId = snapshot.participants.find(
      (entry) => entry.actorId === 'second',
    )?.teamId;

    expect(snapshot).toMatchObject({
      status: 'FINISHED',
      winnerActorId: 'second',
      winnerTeamId: secondTeamId,
    });
    expect(snapshot.participants.find((entry) => entry.actorId === 'first')?.hp).toBe(0);
  });

  it('finishes a simultaneous counter wipe without assigning a defeated winner', () => {
    const { engine, runtime } = activeCombat(
      [actor('first', { hp: 1, maxHp: 1, strength: 100 })],
      [actor('second', { hp: 1, maxHp: 1 })],
    );
    engine.act(runtime, 'first', { action: 'SKIP' }, 1_100);
    engine.act(runtime, 'second', { action: 'COUNTER' }, 1_200);

    const snapshot = engine.act(
      runtime,
      'first',
      { action: 'BASIC_ATTACK', targetActorId: 'second' },
      1_300,
    );

    expect(snapshot.status).toBe('FINISHED');
    expect(snapshot.winnerActorId).toBe(undefined);
    expect(snapshot.winnerTeamId).toBe(undefined);
    expect(snapshot.participants.every((entry) => entry.hp === 0)).toBe(true);
  });
});
