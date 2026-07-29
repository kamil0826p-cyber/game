import { describe, expect, it } from 'vitest';
import type { CombatActionResolutionPayload } from '../src/contracts/socket';
import {
  combatAnimationReducer,
  INITIAL_COMBAT_ANIMATION_STATE,
} from '../src/game/combat/combatAnimationQueue';

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
});
