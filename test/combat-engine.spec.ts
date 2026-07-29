import { describe, expect, it } from 'vitest';
import { CombatEngine } from '../src/modules/combat/combat.engine.js';
import { SKILL_CATALOG } from '../src/modules/skills/skill.catalog.js';
import type { CombatActorInput } from '../src/modules/combat/combat.types.js';

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
  skills: [skill('mage-arcane-spark'), skill('mage-flame-orb')],
  ...overrides,
});

const activeCombat = () => {
  const engine = new CombatEngine(() => 0.5);
  const runtime = engine.createRequest(
    '00000000-0000-4000-8000-000000000001',
    'PVP',
    'map-a',
    actor('first'),
    actor('second'),
    1_000,
    31_000,
  );
  engine.start(runtime, 1_000);
  return { engine, runtime };
};

describe('CombatEngine', () => {
  it('starts with deterministic initiative and resolves a server-side basic attack', () => {
    const { engine, runtime } = activeCombat();

    const snapshot = engine.act(runtime, 'first', { action: 'BASIC_ATTACK' }, 2_000);
    const target = snapshot.participants.find((participant) => participant.actorId === 'second')!;

    expect(snapshot.status).toBe('ACTIVE');
    expect(snapshot.activeActorId).toBe('second');
    expect(target.hp).toBeLessThan(target.maxHp);
    expect(snapshot.recentActions.at(-1)).toMatchObject({
      actorId: 'first',
      action: 'BASIC_ATTACK',
      animationKey: 'basic-attack',
    });
  });

  it('uses learned catalog skills, consumes energy, applies status, and starts cooldown', () => {
    const { engine, runtime } = activeCombat();

    const snapshot = engine.act(
      runtime,
      'first',
      { action: 'SKILL', skillKey: 'mage-flame-orb' },
      2_000,
    );
    const caster = snapshot.participants.find((participant) => participant.actorId === 'first')!;
    const target = snapshot.participants.find((participant) => participant.actorId === 'second')!;

    expect(caster.energy).toBe(102);
    expect(caster.skills.find((entry) => entry.key === 'mage-flame-orb')).toMatchObject({
      cooldownTurnsRemaining: 1,
    });
    expect(target.statuses).toContainEqual(
      expect.objectContaining({ key: 'BURN', turnsRemaining: 2 }),
    );
    expect(snapshot.recentActions.find((action) => action.action === 'SKILL')).toMatchObject({
      action: 'SKILL',
      skillKey: 'mage-flame-orb',
      animationKey: 'mage-flame-orb',
    });
  });

  it('rejects an action from the player who does not own the current turn', () => {
    const { engine, runtime } = activeCombat();

    expect(() => engine.act(runtime, 'second', { action: 'BASIC_ATTACK' }, 2_000)).toThrow(
      'COMBAT_NOT_YOUR_TURN',
    );
  });

  it('finishes a forfeit and records the other actor as winner', () => {
    const { engine, runtime } = activeCombat();

    const snapshot = engine.forfeit(runtime, 'first', 2_000);

    expect(snapshot).toMatchObject({
      status: 'FINISHED',
      winnerActorId: 'second',
      finishReason: 'FORFEIT',
    });
    expect(snapshot.activeActorId).toBeUndefined();
  });
});
