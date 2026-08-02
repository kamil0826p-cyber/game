import { describe, expect, it } from 'vitest';
import { ASHEN_PILGRIMAGE } from '../src/modules/expeditions/expedition.catalog.js';
import { applyExpeditionEncounterVariant } from '../src/modules/expeditions/expedition.encounter.js';
import {
  advanceExpedition,
  checkpointCurrentNode,
  chooseRitual,
  createExpeditionRun,
  failExpedition,
  markExtracted,
  resolveCurrentNode,
  resolveRotationVariant,
  startExpedition,
  terminalLoot,
} from '../src/modules/expeditions/expedition.engine.js';
import type {
  ExpeditionDefinition,
  ExpeditionPreparationSnapshot,
  ExpeditionRunSnapshot,
} from '../src/modules/expeditions/expedition.types.js';
import { inspectExpeditionEncounterParty } from '../src/modules/expeditions/expedition.party.js';
import { validateExpeditionDefinition } from '../src/modules/expeditions/expedition.validator.js';
import { compileExpeditionView } from '../src/modules/expeditions/expedition.view.js';

const validationContext = {
  encounters: new Map([
    ['brood-hunt', { key: 'brood-hunt', version: 1, maximumActors: 7 }],
    ['execution-circle', { key: 'execution-circle', version: 1, maximumActors: 10 }],
  ]),
  itemKeys: new Set(['tempered-chitin-buckler', 'ashen-reliquary-focus']),
};

function preparation(
  overrides: Partial<ExpeditionPreparationSnapshot> = {},
): ExpeditionPreparationSnapshot {
  return {
    leaderCharacterId: '00000000-0000-4000-8000-000000000001',
    members: [
      {
        characterId: '00000000-0000-4000-8000-000000000001',
        name: 'Aldren',
        characterClass: 'WARRIOR',
        level: 20,
        roleKey: 'guardian',
        formation: 'FRONT',
        loadout: {
          skillKeys: ['warrior-shield-bash'],
          fallbackAction: 'DEFEND',
          buildVersion: 1,
          loadoutId: 'default',
          equippedItemIds: ['00000000-0000-4000-8000-000000000101'],
          consumables: [],
          ritualToolItemKeys: [],
        },
      },
    ],
    selectedDifficulty: 'BASE',
    selectedRiskProfileKey: 'guarded',
    acceptedRiskVersion: 1,
    insurancePurchased: false,
    formationKey: 'balanced',
    ritualChoices: {},
    declarativeRoles: {
      '00000000-0000-4000-8000-000000000001': 'guardian',
    },
    lockedFields: [
      'members',
      'loadout',
      'roles',
      'formation',
      'difficulty',
      'risk',
      'insurance',
    ],
    ...overrides,
  };
}

function freshRun(
  overrides: Partial<ExpeditionPreparationSnapshot> = {},
  seed = 77,
): ExpeditionRunSnapshot {
  return startExpedition(
    createExpeditionRun({
      runId: '00000000-0000-4000-8000-000000000212',
      definition: ASHEN_PILGRIMAGE,
      seed,
      preparation: preparation(overrides),
      now: '2026-08-02T08:00:00.000Z',
    }),
    '2026-08-02T08:01:00.000Z',
  );
}

function reachRitualPreparation(seed = 77): ExpeditionRunSnapshot {
  let run = freshRun({}, seed);
  ({ run } = advanceExpedition(run, {
    operationId: 'advance:hollow-road',
    edgeKey: 'take-hollow-road',
    expectedRevision: run.revision,
  }));
  ({ run } = resolveCurrentNode(run, {
    operationId: 'combat:hollow-road',
    expectedRevision: run.revision,
    outcome: 'VICTORY',
  }));
  ({ run } = advanceExpedition(run, {
    operationId: 'advance:ash-tracks',
    edgeKey: 'follow-ash-tracks',
    expectedRevision: run.revision,
  }));
  ({ run } = resolveCurrentNode(run, {
    operationId: 'investigation:ash-tracks',
    expectedRevision: run.revision,
    outcome: 'SUCCESS',
  }));
  ({ run } = advanceExpedition(run, {
    operationId: 'advance:fork',
    edgeKey: 'interpret-ritual-signs',
    expectedRevision: run.revision,
  }));
  ({ run } = advanceExpedition(run, {
    operationId: 'advance:execution-yard',
    edgeKey: 'challenge-executioners',
    expectedRevision: run.revision,
  }));
  ({ run } = resolveCurrentNode(run, {
    operationId: 'combat:execution-yard',
    expectedRevision: run.revision,
    outcome: 'VICTORY',
  }));
  ({ run } = advanceExpedition(run, {
    operationId: 'advance:cache',
    edgeKey: 'take-execution-tithe',
    expectedRevision: run.revision,
  }));
  ({ run } = checkpointCurrentNode(run, {
    operationId: 'checkpoint:cache',
    expectedRevision: run.revision,
  }));
  ({ run } = advanceExpedition(run, {
    operationId: 'advance:ritual-preparation',
    edgeKey: 'descend-to-ritual',
    expectedRevision: run.revision,
  }));
  return run;
}

describe('expedition definition and route validator', () => {
  it('accepts the built-in versioned expedition and its 1-10 encounter references', () => {
    expect(validateExpeditionDefinition(ASHEN_PILGRIMAGE, validationContext)).toEqual({
      errors: [],
      warnings: [],
    });
    expect(ASHEN_PILGRIMAGE.minimumPartySize).toBe(1);
    expect(ASHEN_PILGRIMAGE.maximumPartySize).toBe(10);
  });

  it('rejects unreachable traps, missing items and encounter actor overflow', () => {
    const invalid = structuredClone(ASHEN_PILGRIMAGE) as ExpeditionDefinition;
    invalid.nodes.push({
      key: 'closed-loop',
      type: 'EVENT',
      title: 'Closed loop',
      description: 'No extraction path.',
      outgoing: [
        {
          key: 'repeat-loop',
          toNodeKey: 'closed-loop',
          preview: { threatType: 'Loop' },
        },
      ],
    });
    invalid.lootPools[0]!.entries[0] = {
      key: 'missing-item',
      weight: 1,
      category: 'EQUIPMENT',
      core: true,
      itemKey: 'not-in-catalog',
      quantity: 1,
    };
    const context = {
      ...validationContext,
      encounters: new Map([
        ['brood-hunt', { key: 'brood-hunt', version: 1, maximumActors: 11 }],
        ['execution-circle', { key: 'execution-circle', version: 1, maximumActors: 10 }],
      ]),
    };
    const errors = validateExpeditionDefinition(invalid, context).errors.join('\n');
    expect(errors).toContain('closed-loop is unreachable');
    expect(errors).toContain('closed-loop is trapped');
    expect(errors).toContain('missing item not-in-catalog');
    expect(errors).toContain('exceeds 10 actors');
  });
});

describe('expedition party authorization', () => {
  it('requires the exact frozen party and pending encounter before a mob claim', () => {
    const memberIds = ['member-a', 'member-b'];
    const tracked = {
      runId: 'run-212',
      status: 'ACTIVE' as const,
      memberCharacterIds: memberIds,
      pendingEncounter: {
        nodeKey: 'ritual-hunt',
        encounterKey: 'execution-circle',
        encounterVersion: 1,
        variantKey: 'salted-chains',
      },
    };
    const trackedByCharacterId = new Map(memberIds.map((id) => [id, tracked]));

    expect(
      inspectExpeditionEncounterParty(
        trackedByCharacterId,
        memberIds,
        2,
        'execution-circle',
        1,
      ),
    ).toEqual({
      mode: 'EXPEDITION',
      allowed: true,
      runId: 'run-212',
      variantKey: 'salted-chains',
    });
    expect(
      inspectExpeditionEncounterParty(
        trackedByCharacterId,
        ['member-a'],
        1,
        'execution-circle',
        1,
      ),
    ).toMatchObject({ mode: 'EXPEDITION', allowed: false });
    expect(
      inspectExpeditionEncounterParty(
        trackedByCharacterId,
        memberIds,
        1,
        'execution-circle',
        1,
      ),
    ).toMatchObject({ mode: 'EXPEDITION', allowed: false });
  });
});

describe('expedition deterministic runtime', () => {
  it('accepts every legal party size from 1 through 10', () => {
    for (let size = 1; size <= 10; size += 1) {
      const members = Array.from({ length: size }, (_, index) => ({
        ...preparation().members[0]!,
        characterId: `member-${index + 1}`,
        name: `Member ${index + 1}`,
      }));
      const run = createExpeditionRun({
        runId: `run-${size}`,
        definition: ASHEN_PILGRIMAGE,
        seed: size,
        preparation: preparation({
          members,
          declarativeRoles: Object.fromEntries(
            members.map((member) => [member.characterId, member.roleKey]),
          ),
        }),
        now: '2026-08-02T08:00:00.000Z',
      });
      expect(run.preparation.members).toHaveLength(size);
    }
  });

  it('freezes definition, risk, loadout and party snapshots at creation', () => {
    const mutable = structuredClone(ASHEN_PILGRIMAGE) as ExpeditionDefinition;
    const run = createExpeditionRun({
      runId: '00000000-0000-4000-8000-000000000212',
      definition: mutable,
      seed: 9,
      preparation: preparation(),
      now: '2026-08-02T08:00:00.000Z',
    });
    mutable.name = 'Changed after creation';
    mutable.riskProfiles[0]!.pendingLootLossPercent = 100;
    expect(run.definitionSnapshot.name).toBe('Popielna Pielgrzymka');
    expect(run.riskSnapshot.pendingLootLossPercent).toBe(40);
    expect(run.preparation.members[0]!.loadout.skillKeys).toEqual([
      'warrior-shield-bash',
    ]);
  });

  it('replays an operation id before checking stale revision and never applies it twice', () => {
    const run = freshRun();
    const first = advanceExpedition(run, {
      operationId: 'advance:once',
      edgeKey: 'take-hollow-road',
      expectedRevision: run.revision,
    });
    const replay = advanceExpedition(first.run, {
      operationId: 'advance:once',
      edgeKey: 'enter-bone-marsh',
      expectedRevision: 0,
    });
    expect(replay.run).toEqual(first.run);
    expect(replay.result).toEqual(first.result);
    expect(replay.run.decisions).toHaveLength(1);
  });

  it('requires exactly one disclosed ritual choice and selects its deterministic encounter variant', () => {
    let run = reachRitualPreparation();
    expect(() =>
      advanceExpedition(run, {
        operationId: 'advance:without-choice',
        edgeKey: 'begin-ritual-hunt',
        expectedRevision: run.revision,
      }),
    ).toThrow('EXPEDITION_RITUAL_CHOICE_REQUIRED');

    ({ run } = chooseRitual(run, {
      operationId: 'ritual:salted-chain',
      choiceKey: 'salted-chain',
      expectedRevision: run.revision,
    }));
    expect(() =>
      chooseRitual(run, {
        operationId: 'ritual:change-choice',
        choiceKey: 'blind-lantern',
        expectedRevision: run.revision,
      }),
    ).toThrow('EXPEDITION_RITUAL_ALREADY_CHOSEN');

    const advanced = advanceExpedition(run, {
      operationId: 'advance:ritual-hunt',
      edgeKey: 'begin-ritual-hunt',
      expectedRevision: run.revision,
    });
    expect(advanced.run.pendingEncounter).toMatchObject({
      encounterKey: 'execution-circle',
      encounterVersion: 1,
      variantKey: 'salted-chains',
    });
  });

  it('applies disclosed ritual variants to actual encounter AI and counters', () => {
    const source = {
      definition: {
        key: 'execution-circle',
        version: 1,
        name: 'Krąg Kata',
        difficulty: 'CHALLENGING' as const,
        actors: [
          {
            key: 'executioner',
            role: 'LEADER' as const,
            statScale: 1,
            ai: {
              targetPolicy: 'MARKED_OR_EXPOSED' as const,
              actionWeights: { SKILL: 5 },
            },
          },
          {
            key: 'chain-guard',
            role: 'FRONTLINER' as const,
            statScale: 0.9,
            ai: {
              targetPolicy: 'PROTECT_LEADER' as const,
              actionWeights: { INTERCEPT: 6 },
            },
          },
        ],
        initialActorKeys: ['executioner'],
        phases: [{ key: 'opening', mechanics: ['MARKED_EXECUTION'] }],
        scaling: [],
        telegraphs: [{ skillKey: 'warrior-cleave', counters: ['DEFEND' as const] }],
      },
      tier: {
        minPartySize: 1,
        actorKeys: ['executioner'],
        healthMultiplier: 1,
        powerMultiplier: 1,
        rewardMultiplier: 1,
        telegraphTargetCount: 2,
        breakCapacity: 1,
        targetTurns: 8,
        mechanics: ['MARKED_EXECUTION'],
      },
      partySize: 1,
      initialActorKeys: ['executioner'],
      pendingSummonKeys: [],
    };
    const salted = applyExpeditionEncounterVariant(source, 'salted-chains');
    expect(salted.definition.actors[0]!.statScale).toBe(0.9);
    expect(salted.definition.actors[1]!.ai.actionWeights.INTERCEPT).toBe(3);
    expect(salted.definition.telegraphs[0]!.counters).toContain('INTERRUPT');

    const blinded = applyExpeditionEncounterVariant(source, 'blind-lantern');
    expect(blinded.definition.actors[0]!.ai.targetPolicy).toBe('FRONT_LINE');
    expect(blinded.definition.phases[0]!.arenaModifier).toBe('BLIND_LANTERN');
    expect(blinded.tier.telegraphTargetCount).toBe(1);
    expect(source.definition.actors[0]!.ai.targetPolicy).toBe('MARKED_OR_EXPOSED');
  });

  it('produces the same full deep route for the same snapshot and seed', () => {
    const complete = (): ExpeditionRunSnapshot => {
      let run = reachRitualPreparation(1234);
      ({ run } = chooseRitual(run, {
        operationId: 'ritual:blind-lantern',
        choiceKey: 'blind-lantern',
        expectedRevision: run.revision,
      }));
      ({ run } = advanceExpedition(run, {
        operationId: 'advance:ritual-hunt',
        edgeKey: 'begin-ritual-hunt',
        expectedRevision: run.revision,
      }));
      ({ run } = resolveCurrentNode(run, {
        operationId: 'combat:ritual-hunt',
        expectedRevision: run.revision,
        outcome: 'VICTORY',
      }));
      ({ run } = advanceExpedition(run, {
        operationId: 'advance:deep-extraction',
        edgeKey: 'leave-deep-sanctum',
        expectedRevision: run.revision,
      }));
      expect(terminalLoot(run).length).toBeGreaterThan(0);
      ({ run } = markExtracted(run, {
        operationId: 'extract:deep',
        expectedRevision: run.revision,
        now: '2026-08-02T09:00:00.000Z',
      }));
      return run;
    };
    expect(complete()).toEqual(complete());
    expect(complete().status).toBe('COMPLETED');
  });

  it('keeps secured loot and applies accepted risk plus insurance to pending loot and consequences', () => {
    const uninsured = freshRun();
    uninsured.pendingLoot = [
      { sourceKey: 'test:silver', category: 'SILVER', silver: 100, core: true },
      { sourceKey: 'test:item', category: 'EQUIPMENT', itemKey: 'tempered-chitin-buckler', quantity: 10, core: true },
    ];
    uninsured.securedLoot = [
      { sourceKey: 'test:secured', category: 'SILVER', silver: 25, core: true },
    ];
    const failedUninsured = failExpedition(uninsured, {
      operationId: 'failure:uninsured',
      expectedRevision: uninsured.revision,
      sourceNodeKey: uninsured.currentNodeKey,
    }).run;

    const insured = freshRun({ insurancePurchased: true });
    insured.pendingLoot = structuredClone(uninsured.pendingLoot);
    insured.securedLoot = structuredClone(uninsured.securedLoot);
    const failedInsured = failExpedition(insured, {
      operationId: 'failure:insured',
      expectedRevision: insured.revision,
      sourceNodeKey: insured.currentNodeKey,
    }).run;

    expect(failedUninsured.securedLoot).toEqual(uninsured.securedLoot);
    expect(failedUninsured.pendingLoot.find((stack) => stack.silver)?.silver).toBe(60);
    expect(failedInsured.pendingLoot.find((stack) => stack.silver)?.silver).toBe(85);
    expect(failedUninsured.consequences[0]?.severity).toBe(1);
    expect(failedInsured.consequences).toEqual([]);
  });
});

describe('expedition public contract and rotation', () => {
  it('hides difficulty-specific route intelligence and never exposes the deterministic seed', () => {
    const run = freshRun({ selectedDifficulty: 'RITUAL' });
    const view = compileExpeditionView(run);
    expect(view.availableRoutes).toHaveLength(2);
    expect(view.availableRoutes[0]).not.toHaveProperty('knownCost');
    expect(view.availableRoutes[0]).not.toHaveProperty('scoutHint');
    expect(view.availableRoutes[0]).toHaveProperty('rewardCategory');
    expect(view).not.toHaveProperty('seed');
  });

  it('publishes a terminal report with outcome, node, duration, economy and group size', () => {
    let run = freshRun();
    run.currentNodeKey = 'safe-extraction';
    run.visitedNodeKeys.push('safe-extraction');
    run.securedLoot = [
      { sourceKey: 'secured:silver', category: 'SILVER', silver: 20, core: true },
    ];
    run.pendingLoot = [
      { sourceKey: 'pending:item', category: 'EQUIPMENT', itemKey: 'tempered-chitin-buckler', quantity: 1, core: true },
    ];
    run.contributions.push({
      combatId: '00000000-0000-4000-8000-000000000999',
      encounterKey: 'brood-hunt',
      encounterVersion: 1,
      characterId: run.preparation.members[0]!.characterId,
      eligible: true,
      eligibilityReason: 'ELIGIBLE',
      score: 145,
      activeTurnRatio: 1,
      actions: 4,
      timedOutTurns: 0,
      damage: 120,
      healing: 0,
      protection: 25,
      interrupts: 1,
      cleanses: 0,
      mechanics: 1,
    });
    ({ run } = markExtracted(run, {
      operationId: 'extract:report',
      expectedRevision: run.revision,
      now: '2026-08-02T08:11:00.000Z',
    }));
    const view = compileExpeditionView(run);
    expect(view.finalReport).toMatchObject({
      outcome: 'EXTRACTED',
      completionNodeKey: 'safe-extraction',
      groupSize: 1,
      durationMs: 600_000,
      economy: {
        securedSilver: 20,
        pendingSilver: 0,
        securedItemQuantity: 0,
        pendingItemQuantity: 1,
      },
      contributions: [{
        characterId: run.preparation.members[0]!.characterId,
        encounters: 1,
        eligibleEncounters: 1,
        score: 145,
        damage: 120,
        protection: 25,
      }],
    });
  });

  it('reveals conditional branch-gate routes only when the authored condition passes', () => {
    const run = freshRun();
    run.currentNodeKey = 'fork-of-vows';
    run.visitedNodeKeys.push('fork-of-vows');
    const withoutOath = compileExpeditionView(run, () => false);
    const withOath = compileExpeditionView(run, () => true);
    expect(withoutOath.availableRoutes.map((route) => route.key)).toEqual([
      'hunt-brood',
      'challenge-executioners',
    ]);
    expect(withOath.availableRoutes.map((route) => route.key)).toContain(
      'invoke-ashen-oath',
    );
  });

  it('replays an extraction request without changing rewards or revision', () => {
    let run = freshRun();
    run.currentNodeKey = 'safe-extraction';
    const first = markExtracted(run, {
      operationId: 'extract:idempotent',
      expectedRevision: run.revision,
      now: '2026-08-02T08:11:00.000Z',
    });
    const replay = markExtracted(first.run, {
      operationId: 'extract:idempotent',
      expectedRevision: 0,
      now: '2030-01-01T00:00:00.000Z',
    });
    expect(replay.run).toEqual(first.run);
    expect(replay.result).toEqual(first.result);
  });

  it('rotates broad weekly variants while preserving core rewards', () => {
    expect(resolveRotationVariant(ASHEN_PILGRIMAGE, 0)).toEqual({
      variantKey: 'ashen-wind',
      coreRewardsRemainAvailable: true,
    });
    expect(resolveRotationVariant(ASHEN_PILGRIMAGE, 7)).toEqual({
      variantKey: 'silent-bells',
      coreRewardsRemainAvailable: true,
    });
    expect(ASHEN_PILGRIMAGE.rotationPolicy.broadWindowDays).toBeGreaterThanOrEqual(7);
  });
});
