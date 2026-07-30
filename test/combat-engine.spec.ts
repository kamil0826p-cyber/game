import { describe, expect, it } from 'vitest';
import { CombatEngine } from '../src/modules/combat/combat.engine.js';
import { SKILL_CATALOG } from '../src/modules/skills/skill.catalog.js';
import type { CombatActorInput, CombatTeamInput } from '../src/modules/combat/combat.types.js';

const skill = (key: string) => {
  const definition = SKILL_CATALOG.find((candidate) => candidate.key === key);
  if (!definition) throw new Error(`Missing test skill ${key}`);
  return { definition, cooldownTurnsRemaining: 0 };
};

const actor = (actorId: string, overrides: Partial<CombatActorInput> = {}): CombatActorInput => ({
  actorId,
  characterId: actorId,
  kind: 'PLAYER',
  name: actorId,
  characterClass: 'MAGE',
  level: 20,
  outfitKey: 'mage-apprentice',
  hp: 180,
  maxHp: 180,
  energy: 120,
  maxEnergy: 120,
  strength: 8,
  agility: actorId === 'first' ? 20 : 10,
  intelligence: 30,
  armor: 12,
  skills: [
    skill('mage-arcane-spark'),
    skill('mage-flame-orb'),
    skill('mage-frost-nova'),
  ],
  ...overrides,
});

const team = (anchorActorId: string, actors: CombatActorInput[]): CombatTeamInput => ({
  anchorActorId,
  actors,
});

const activeCombat = () => {
  const engine = new CombatEngine(() => 0.5);
  const runtime = engine.createRequest(
    '00000000-0000-4000-8000-000000000001',
    'PVP',
    'map-a',
    team('first', [actor('first')]),
    team('second', [actor('second')]),
    1_000,
    31_000,
  );
  engine.start(runtime, 1_000);
  return { engine, runtime };
};

const activeGroupCombat = () => {
  const engine = new CombatEngine(() => 0.5);
  const runtime = engine.createRequest(
    '00000000-0000-4000-8000-000000000002',
    'PVP',
    'map-a',
    team('first', [actor('first', { agility: 30 }), actor('ally', { agility: 20 })]),
    team('enemy-a', [actor('enemy-a', { agility: 15 }), actor('enemy-b', { agility: 10 })]),
    1_000,
    31_000,
  );
  engine.start(runtime, 1_000);
  return { engine, runtime };
};

describe('CombatEngine', () => {
  it('starts without emitting a fake opening action', () => {
    const { engine, runtime } = activeCombat();
    expect(engine.snapshot(runtime).recentActions).toEqual([]);
  });

  it('starts with deterministic initiative and resolves a server-side basic attack', () => {
    const { engine, runtime } = activeCombat();
    const snapshot = engine.act(runtime, 'first', { action: 'BASIC_ATTACK' }, 2_000);
    const target = snapshot.participants.find((participant) => participant.actorId === 'second')!;
    expect(snapshot.status).toBe('ACTIVE');
    expect(snapshot.activeActorId).toBe('second');
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(snapshot.recentActions.at(-1)).toMatchObject({
      sequence: 1,
      actorId: 'first',
      action: 'BASIC_ATTACK',
      animationKey: 'basic-attack',
    });
  });

  it('uses learned catalog skills, consumes energy, applies status, and starts cooldown', () => {
    const { engine, runtime } = activeCombat();
    const snapshot = engine.act(runtime, 'first', { action: 'SKILL', skillKey: 'mage-flame-orb' }, 2_000);
    const caster = snapshot.participants.find((participant) => participant.actorId === 'first')!;
    const target = snapshot.participants.find((participant) => participant.actorId === 'second')!;
    expect(caster.energy).toBe(102);
    expect(caster.skills.find((entry) => entry.key === 'mage-flame-orb')).toMatchObject({ cooldownTurnsRemaining: 1 });
    expect(target.statuses).toContainEqual(expect.objectContaining({ key: 'BURN', turnsRemaining: 2 }));
  });

  it('rejects an action from the player who does not own the current turn', () => {
    const { engine, runtime } = activeCombat();
    expect(() => engine.act(runtime, 'second', { action: 'BASIC_ATTACK' }, 2_000)).toThrow('COMBAT_NOT_YOUR_TURN');
  });

  it('finishes a one-versus-one forfeit and records the opposing team', () => {
    const { engine, runtime } = activeCombat();
    const snapshot = engine.forfeit(runtime, 'first', 2_000);
    expect(snapshot).toMatchObject({ status: 'FINISHED', winnerActorId: 'second', finishReason: 'FORFEIT' });
    expect(snapshot.winnerTeamId).toBe(snapshot.teams?.[1].teamId);
  });

  it('attacks the explicitly selected living enemy', () => {
    const { engine, runtime } = activeGroupCombat();
    const snapshot = engine.act(runtime, 'first', { action: 'BASIC_ATTACK', targetActorId: 'enemy-b' }, 2_000);
    const firstEnemy = snapshot.participants.find((participant) => participant.actorId === 'enemy-a')!;
    const selectedEnemy = snapshot.participants.find((participant) => participant.actorId === 'enemy-b')!;
    expect(firstEnemy.hp).toBe(firstEnemy.maxHp);
    expect(selectedEnemy.hp).toBeLessThan(selectedEnemy.maxHp);
  });

  it('resolves AREA skills against every living enemy', () => {
    const { engine, runtime } = activeGroupCombat();
    const snapshot = engine.act(runtime, 'first', { action: 'SKILL', skillKey: 'mage-frost-nova' }, 2_000);
    const enemies = snapshot.participants.filter((participant) => ['enemy-a', 'enemy-b'].includes(participant.actorId));
    expect(enemies).toHaveLength(2);
    expect(enemies.every((participant) => participant.hp < participant.maxHp)).toBe(true);
    expect(snapshot.recentActions.at(-1)?.results).toHaveLength(2);
  });

  it('keeps the combat active when one member withdraws and their team still has fighters', () => {
    const { engine, runtime } = activeGroupCombat();
    const snapshot = engine.forfeit(runtime, 'ally', 2_000);
    const ally = snapshot.participants.find((participant) => participant.actorId === 'ally')!;
    expect(snapshot.status).toBe('ACTIVE');
    expect(ally.withdrawn).toBe(true);
    expect(snapshot.activeActorId).toBe('first');
  });

  it('finishes only after the complete enemy team is defeated', () => {
    const engine = new CombatEngine(() => 0.5);
    const runtime = engine.createRequest(
      '00000000-0000-4000-8000-000000000003',
      'PVP',
      'map-a',
      team('first', [actor('first', { agility: 30, intelligence: 100 })]),
      team('enemy-a', [actor('enemy-a', { hp: 1, maxHp: 1 }), actor('enemy-b', { hp: 1, maxHp: 1 })]),
      1_000,
      31_000,
    );
    engine.start(runtime, 1_000);
    const snapshot = engine.act(runtime, 'first', { action: 'SKILL', skillKey: 'mage-frost-nova' }, 2_000);
    expect(snapshot.status).toBe('FINISHED');
    expect(snapshot.winnerTeamId).toBe(snapshot.teams?.[0].teamId);
    expect(snapshot.participants.filter((participant) => participant.teamId === snapshot.teams?.[1].teamId).every((participant) => participant.hp === 0)).toBe(true);
  });
});
