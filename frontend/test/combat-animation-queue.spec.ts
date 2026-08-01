import { describe, expect, it } from 'vitest';
import '../src/contracts/tacticalCombat';
import type { CombatActionResolutionPayload } from '../src/contracts/socket';
import {
  combatAnimationReducer,
  INITIAL_COMBAT_ANIMATION_STATE,
} from '../src/game/combat/combatAnimationQueue';
import { usesAttackMotion } from '../src/game/combat/combatPresentation';

const action = (sequence: number): CombatActionResolutionPayload =>
  ({
    sequence,
    visual: {},
  }) as CombatActionResolutionPayload;

describe('combat animation queue', () => {
  it('advances through consecutive actions and ignores duplicate snapshots', () => {
    const first = action(1);
    const second = action(2);

    const started = combatAnimationReducer(INITIAL_COMBAT_ANIMATION_STATE, {
      type: 'SYNC',
      actions: [first],
    });
    expect(started.current).toBe(first);
    expect(started.pending).toEqual([]);

    const queued = combatAnimationReducer(started, {
      type: 'SYNC',
      actions: [first, second],
    });
    expect(queued.current).toBe(first);
    expect(queued.pending).toEqual([second]);

    const duplicate = combatAnimationReducer(queued, {
      type: 'SYNC',
      actions: [first, second],
    });
    expect(duplicate).toBe(queued);

    const advanced = combatAnimationReducer(duplicate, {
      type: 'FINISH',
      sequence: first.sequence,
    });
    expect(advanced.current).toBe(second);
    expect(advanced.pending).toEqual([]);

    const finished = combatAnimationReducer(advanced, {
      type: 'FINISH',
      sequence: second.sequence,
    });
    expect(finished.current).toBeUndefined();
  });

  it('does not let an obsolete timer finish a newer animation', () => {
    const current = combatAnimationReducer(INITIAL_COMBAT_ANIMATION_STATE, {
      type: 'SYNC',
      actions: [action(7)],
    });

    expect(
      combatAnimationReducer(current, {
        type: 'FINISH',
        sequence: 6,
      }),
    ).toBe(current);
  });

  it('queues counter damage as a separate attack made by the defending actor', () => {
    const incomingAttack: CombatActionResolutionPayload = {
      sequence: 12,
      actorId: 'mob-1',
      targetActorId: 'player-1',
      action: 'BASIC_ATTACK',
      label: 'Basic attack',
      animationKey: 'basic-attack',
      visual: {
        castEffectKey: 'basic-attack:cast',
        projectileEffectKey: 'vfx:weapon-trail',
        impactEffectKey: 'basic-attack:impact',
        accentColor: '#f5d88a',
        travelMs: 280,
      },
      results: [
        {
          targetActorId: 'player-1',
          hpDelta: -30,
          energyDelta: 0,
          shieldDelta: 0,
          shieldAbsorbed: 0,
          dodged: false,
          statusesApplied: [],
          statusesRemoved: ['COUNTER_READY'],
          counterDamage: 9,
        },
      ],
      occurredAt: 1_000,
    };

    const started = combatAnimationReducer(INITIAL_COMBAT_ANIMATION_STATE, {
      type: 'SYNC',
      actions: [incomingAttack],
    });

    expect(started.current).toBe(incomingAttack);
    expect(started.pending).toHaveLength(1);

    const counter = started.pending[0]!;
    expect(counter.sequence).toBeGreaterThan(incomingAttack.sequence);
    expect(counter.sequence).toBeLessThan(incomingAttack.sequence + 1);
    expect(counter).toMatchObject({
      actorId: 'player-1',
      targetActorId: 'mob-1',
      action: 'BASIC_ATTACK',
      skillKey: 'tactical:counter-strike',
      animationKey: 'tactical-counter-strike',
      results: [{ targetActorId: 'mob-1', hpDelta: -9 }],
    });
    expect(usesAttackMotion(counter)).toBe(true);

    const counterStarted = combatAnimationReducer(started, {
      type: 'FINISH',
      sequence: incomingAttack.sequence,
    });
    expect(counterStarted.current).toBe(counter);

    const duplicate = combatAnimationReducer(counterStarted, {
      type: 'SYNC',
      actions: [incomingAttack],
    });
    expect(duplicate).toBe(counterStarted);
  });
});
