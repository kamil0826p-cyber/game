import type { CombatActionResolutionPayload } from '../../contracts/socket';

export interface CombatAnimationState {
  current: CombatActionResolutionPayload | undefined;
  pending: CombatActionResolutionPayload[];
  seenSequence: number;
}

export type CombatAnimationEvent =
  | {
      type: 'SYNC';
      actions: CombatActionResolutionPayload[];
    }
  | {
      type: 'FINISH';
      sequence: number;
    };

export const INITIAL_COMBAT_ANIMATION_STATE: CombatAnimationState = {
  current: undefined,
  pending: [],
  seenSequence: 0,
};

export function combatAnimationReducer(
  state: CombatAnimationState,
  event: CombatAnimationEvent,
): CombatAnimationState {
  if (event.type === 'FINISH') {
    if (state.current?.sequence !== event.sequence) return state;
    const [current, ...pending] = state.pending;
    return { ...state, current, pending };
  }

  const unseen = event.actions
    .filter((action) => action.sequence > state.seenSequence)
    .sort((left, right) => left.sequence - right.sequence);
  if (unseen.length === 0) return state;

  const queued = [...state.pending, ...unseen];
  const [current, ...pending] = state.current ? [state.current, ...queued] : queued;
  return {
    current,
    pending,
    seenSequence: unseen.at(-1)!.sequence,
  };
}

export function combatAnimationDuration(action: CombatActionResolutionPayload): number {
  return Math.max(760, (action.visual.travelMs ?? 360) + 520);
}
