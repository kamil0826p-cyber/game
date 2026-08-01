import { describe, expect, it } from 'vitest';
import { CombatEngine } from '../src/modules/combat/combat.engine.js';
import type { CombatActorInput } from '../src/modules/combat/combat.types.js';

function fighter(actorId: string, strength: number, armor = 0): CombatActorInput {
  return {
    actorId,
    characterId: actorId,
    kind: 'PLAYER',
    name: actorId,
    characterClass: 'WARRIOR',
    level: 100,
    outfitKey: 'warrior',
    hp: 5_000,
    maxHp: 5_000,
    energy: 100,
    maxEnergy: 100,
    strength,
    agility: actorId === 'attacker' ? 1_000 : 0,
    intelligence: 0,
    armor,
    skills: [],
  };
}

function basicAttackDamage(strength: number, targetArmor: number): number {
  const engine = new CombatEngine(() => 0.5);
  const runtime = engine.createRequest(
    `caps:${strength}:${targetArmor}`,
    'PVP',
    'test-map',
    { anchorActorId: 'attacker', actors: [fighter('attacker', strength)] },
    { anchorActorId: 'target', actors: [fighter('target', 0, targetArmor)] },
    0,
    30_000,
  );
  engine.start(runtime, 0);
  const snapshot = engine.act(runtime, 'attacker', {
    action: 'BASIC_ATTACK',
    targetActorId: 'target',
  }, 1_000);
  return Math.abs(snapshot.recentActions.find((action) => action.actorId === 'attacker')!.results[0]!.hpDelta);
}

describe('combat progression caps', () => {
  it('hard-caps excessive primary stats inside the production combat engine', () => {
    expect(basicAttackDamage(200, 0)).toBe(basicAttackDamage(1_000, 0));
  });

  it('hard-caps excessive armor inside production mitigation', () => {
    expect(basicAttackDamage(140, 160)).toBe(basicAttackDamage(140, 1_000));
  });
});
