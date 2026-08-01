import { describe, expect, it } from 'vitest';
import type {
  CombatLegalAction,
  CombatRuntime,
  CombatRuntimeActor,
} from '../src/modules/combat/combat.types.js';
import {
  filterRedundantEncounterActions,
  planEncounterAction,
} from '../src/modules/mobs/encounters/encounter.ai.js';
import type { EncounterRuntimeState } from '../src/modules/mobs/encounters/encounter.types.js';

function runtimeActor(
  actorId: string,
  teamId: string,
  statuses: Array<{ key: string; turnsRemaining: number }> = [],
): CombatRuntimeActor {
  return {
    actorId,
    teamId,
    statuses: statuses.map((status, index) => ({
      id: `${actorId}:${status.key}:${index}`,
      key: status.key,
      turnsRemaining: status.turnsRemaining,
      sourceActorId: actorId,
      sourcePower: 1,
      appliedTurn: 1,
    })),
    hp: 100,
    maxHp: 100,
    energy: 100,
    maxEnergy: 100,
    formationLine: 'FRONT',
  } as CombatRuntimeActor;
}

function combatRuntime(actors: CombatRuntimeActor[]): CombatRuntime {
  return {
    combatId: 'encounter-ai-audit',
    phase: 'DECISION',
    turnNumber: 3,
    actors,
  } as CombatRuntime;
}

describe('encounter AI audit guards', () => {
  it('removes tactical actions whose effects are already active', () => {
    const acting = runtimeActor('guard', 'enemy', [
      { key: 'GUARD', turnsRemaining: 1 },
      { key: 'COUNTER_READY', turnsRemaining: 1 },
    ]);
    const exposed = runtimeActor('player-exposed', 'players', [
      { key: 'EXPOSED', turnsRemaining: 2 },
    ]);
    const taunted = runtimeActor('player-taunted', 'players', [
      { key: 'TAUNT', turnsRemaining: 1 },
    ]);
    const unmarked = runtimeActor('player-free', 'players');
    const protectedAlly = runtimeActor('ally-protected', 'enemy', [
      { key: 'PROTECTED', turnsRemaining: 2 },
    ]);
    const runtime = combatRuntime([
      acting,
      exposed,
      taunted,
      unmarked,
      protectedAlly,
    ]);
    const legalActions: CombatLegalAction[] = [
      {
        action: 'MARK',
        targeting: 'ENEMY',
        targetActorIds: [exposed.actorId, unmarked.actorId],
      },
      {
        action: 'TAUNT',
        targeting: 'ENEMY',
        targetActorIds: [taunted.actorId, unmarked.actorId],
      },
      {
        action: 'INTERCEPT',
        targeting: 'ALLY',
        targetActorIds: [protectedAlly.actorId],
      },
      { action: 'DEFEND', targeting: 'SELF', targetActorIds: [acting.actorId] },
      { action: 'COUNTER', targeting: 'SELF', targetActorIds: [acting.actorId] },
      {
        action: 'BASIC_ATTACK',
        targeting: 'ENEMY',
        targetActorIds: [unmarked.actorId],
      },
    ];

    const filtered = filterRedundantEncounterActions(runtime, acting, legalActions);

    expect(filtered).toContainEqual(
      expect.objectContaining({ action: 'MARK', targetActorIds: [unmarked.actorId] }),
    );
    expect(filtered).toContainEqual(
      expect.objectContaining({ action: 'TAUNT', targetActorIds: [unmarked.actorId] }),
    );
    expect(filtered.some((action) => action.action === 'INTERCEPT')).toBe(false);
    expect(filtered.some((action) => action.action === 'DEFEND')).toBe(false);
    expect(filtered.some((action) => action.action === 'COUNTER')).toBe(false);
    expect(filtered.some((action) => action.action === 'BASIC_ATTACK')).toBe(true);
  });

  it('lets a frontliner use its weighted offensive actions instead of always defending', () => {
    const frontliner = runtimeActor('chain-guard', 'enemy');
    const player = runtimeActor('player-1', 'players');
    const runtime = combatRuntime([frontliner, player]);
    runtime.activeActorId = frontliner.actorId;
    const state = {
      phaseIndex: 0,
      phaseKey: 'opening',
      seed: 7,
      actorKeyById: new Map([[frontliner.actorId, 'chain-guard']]),
      actorIdByKey: new Map([['chain-guard', frontliner.actorId]]),
      encounter: {
        definition: {
          phases: [{ key: 'opening', mechanics: [] }],
          actors: [
            {
              key: 'chain-guard',
              role: 'FRONTLINER',
              ai: {
                role: 'FRONTLINER',
                targetPolicy: 'FRONT_LINE',
                actionWeights: { SKILL: 100, BASIC_ATTACK: 0, DEFEND: 0 },
              },
            },
          ],
        },
      },
    } as unknown as EncounterRuntimeState;
    const legalActions: CombatLegalAction[] = [
      {
        action: 'SKILL',
        skillKey: 'warrior-shield-bash',
        targeting: 'ENEMY',
        targetActorIds: [player.actorId],
      },
      {
        action: 'BASIC_ATTACK',
        targeting: 'ENEMY',
        targetActorIds: [player.actorId],
      },
      {
        action: 'DEFEND',
        targeting: 'SELF',
        targetActorIds: [frontliner.actorId],
      },
    ];

    expect(planEncounterAction(runtime, frontliner, state, legalActions)?.command).toMatchObject({
      action: 'SKILL',
      skillKey: 'warrior-shield-bash',
      targetActorId: player.actorId,
    });
  });
});
