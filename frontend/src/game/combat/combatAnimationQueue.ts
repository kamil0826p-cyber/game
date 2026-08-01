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

const COUNTER_SEQUENCE_STEP = 1 / 1_000;
const COUNTER_VISUAL: CombatActionResolutionPayload['visual'] = {
  castEffectKey: 'tactical-counter:cast',
  projectileEffectKey: 'vfx:weapon-trail',
  impactEffectKey: 'tactical-counter:impact',
  accentColor: '#f5d88a',
  travelMs: 220,
};

function counterAnimationFrames(
  action: CombatActionResolutionPayload,
): CombatActionResolutionPayload[] {
  return action.results.flatMap((result, index) => {
    const counterDamage = result.counterDamage ?? 0;
    if (counterDamage <= 0) return [];

    return [
      {
        sequence: action.sequence + (index + 1) * COUNTER_SEQUENCE_STEP,
        actorId: result.targetActorId,
        targetActorId: action.actorId,
        action: 'BASIC_ATTACK',
        skillKey: 'tactical:counter-strike',
        label: 'Counter attack',
        animationKey: 'tactical-counter-strike',
        visual: COUNTER_VISUAL,
        results: [
          {
            targetActorId: action.actorId,
            hpDelta: -counterDamage,
            energyDelta: 0,
            shieldDelta: 0,
            shieldAbsorbed: 0,
            dodged: false,
            statusesApplied: [],
            statusesRemoved: [],
          },
        ],
        occurredAt: action.occurredAt,
      },
    ];
  });
}

function animationFrames(
  actions: readonly CombatActionResolutionPayload[],
): CombatActionResolutionPayload[] {
  return actions.flatMap((action) => [action, ...counterAnimationFrames(action)]);
}

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

  const queued = [...state.pending, ...animationFrames(unseen)];
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
