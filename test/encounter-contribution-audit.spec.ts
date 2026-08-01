import { describe, expect, it } from 'vitest';
import type {
  CombatRuntime,
  CombatRuntimeActor,
} from '../src/modules/combat/combat.types.js';
import {
  evaluateEncounterEligibility,
  ingestEncounterRuntimeEvents,
} from '../src/modules/mobs/encounters/encounter.runtime.js';
import type {
  EncounterContribution,
  EncounterRuntimeState,
} from '../src/modules/mobs/encounters/encounter.types.js';

function actor(
  actorId: string,
  teamId: string,
  kind: 'PLAYER' | 'MOB',
): CombatRuntimeActor {
  return {
    actorId,
    characterId: kind === 'PLAYER' ? actorId : undefined,
    kind,
    teamId,
    hp: 100,
    maxHp: 100,
    withdrawn: false,
    statuses: [],
  } as CombatRuntimeActor;
}

function contribution(actorId: string): EncounterContribution {
  return {
    actorId,
    joinedTurn: 1,
    actions: 0,
    timedOutTurns: 0,
    pendingTimeoutActions: 0,
    damage: 0,
    healing: 0,
    protection: 0,
    interrupts: 0,
    cleanses: 0,
    mechanics: 0,
  };
}

function encounterState(): EncounterRuntimeState {
  return {
    processedEventSequence: 0,
    contributions: new Map(),
    observedTelegraphs: new Map(),
    resolvedTelegraphs: [],
    encounter: {
      definition: {
        telegraphs: [],
        reward: {
          minimumActiveTurnRatio: 0.25,
          minimumContribution: 2,
          lateJoinCutoff: 0.65,
        },
      },
    },
  } as unknown as EncounterRuntimeState;
}

describe('encounter contribution audit', () => {
  it('credits intercepted damage and counter damage to the defending player', () => {
    const mob = actor('mob-1', 'enemies', 'MOB');
    const tank = actor('tank-1', 'players', 'PLAYER');
    const runtime = {
      turnNumber: 4,
      actors: [mob, tank],
      events: [
        {
          sequence: 1,
          actorId: mob.actorId,
          targetActorId: tank.actorId,
          action: 'BASIC_ATTACK',
          label: 'Basic attack',
          animationKey: 'basic-attack',
          visual: {},
          results: [
            {
              targetActorId: tank.actorId,
              hpDelta: -20,
              energyDelta: 0,
              shieldDelta: 0,
              shieldAbsorbed: 0,
              dodged: false,
              statusesApplied: [],
              statusesRemoved: ['COUNTER_READY'],
              interceptedByActorId: tank.actorId,
              counterDamage: 7,
            },
          ],
          occurredAt: 1_000,
        },
      ],
    } as CombatRuntime;
    const state = encounterState();

    ingestEncounterRuntimeEvents(runtime, state);

    expect(state.contributions.get(tank.actorId)).toMatchObject({
      damage: 7,
      protection: 20,
    });
    expect(state.processedEventSequence).toBe(1);

    ingestEncounterRuntimeEvents(runtime, state);
    expect(state.contributions.get(tank.actorId)).toMatchObject({
      damage: 7,
      protection: 20,
    });
  });

  it('does not grant eligibility for actions with no measurable contribution', () => {
    const player = actor('player-1', 'players', 'PLAYER');
    const runtime = {
      turnNumber: 5,
      actors: [player],
    } as CombatRuntime;
    const state = encounterState();
    const entry = contribution(player.actorId);
    entry.actions = 1;
    state.contributions.set(player.actorId, entry);

    expect(evaluateEncounterEligibility(runtime, state, player.actorId)).toMatchObject({
      eligible: false,
      reason: 'NO_CONTRIBUTION',
      score: 0,
    });
  });
});
