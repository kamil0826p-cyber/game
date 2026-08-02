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
import { inspectExpeditionEncounterParty } from '../src/modules/expeditions/expedition.party.js';
import type {
  ExpeditionDefinition,
  ExpeditionPreparationSnapshot,
  ExpeditionRunSnapshot,
} from '../src/modules/expeditions/expedition.types.js';
import { validateExpeditionDefinition } from '../src/modules/expeditions/expedition.validator.js';
import { compileExpeditionView } from '../src/modules/expeditions/expedition.view.js';
import { ENCOUNTER_CATALOG } from '../src/modules/mobs/encounters/encounter.catalog.js';
import { scaleEncounter } from '../src/modules/mobs/encounters/encounter.scaling.js';

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

describe('expedition authored content', () => {
  it('validates the built-in graph and rejects traps, missing items and actor overflow', () => {
    expect(validateExpeditionDefinition(ASHEN_PILGRIMAGE, validationContext)).toEqual({
      errors: [],
      warnings: [],
    });
    const invalid = structuredClone(ASHEN_PILGRIMAGE) as ExpeditionDefinition;
    invalid.nodes.push({
      key: 'closed-loop',
      type: 'EVENT',
      title: 'Closed loop',
      description: 'No extraction path.',
      outgoing: [{
        key: 'repeat-loop',
        toNodeKey: 'closed-loop',
        preview: { threatType: 'Loop' },
      }],
    });
    invalid.lootPools[0]!.entries[0] = {
      key: 'missing-item',
      weight: 1,
      category: 'EQUIPMENT',
      core: true,
      itemKey: 'not-in-catalog',
      quantity: 1,
    };
    const errors = validateExpeditionDefinition(invalid, {
      ...validationContext,
      encounters: new Map([
        ['brood-hunt', { key: 'brood-hunt', version: 1, maximumActors: 11 }],
        ['execution-circle', { key: 'execution-circle', version: 1, maximumActors: 10 }],
      ]),
    }).errors.join('\n');
    expect(errors).toContain('closed-loop is unreachable');
    expect(errors).toContain('closed-loop is trapped');
    expect(errors).toContain('missing item not-in-catalog');
    expect(errors).toContain('exceeds 10 actors');
  });

  it('authorizes only the exact frozen party and active encounter', () => {
    const ids = ['member-a', 'member-b'];
    const tracked = {
      runId: 'run-212',
      status: 'ACTIVE' as const,
      memberCharacterIds: ids,
      pendingEncounter: {
        nodeKey: 'ritual-hunt',
        encounterKey: 'execution-circle',
        encounterVersion: 1,
        variantKey: 'salted-chains',
      },
    };
    const registry = new Map(ids.map((id) => [id, tracked]));
    expect(
      inspectExpeditionEncounterParty(
        registry,
        ids,
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
        registry,
        ['member-a'],
        1,
        'execution-circle',
        1,
      ),
    ).toMatchObject({ mode: 'EXPEDITION', allowed: false });
  });
});

describe('expedition deterministic runtime', () => {
  it('supports parties 1-10 and freezes definition, risk and active loadout snapshots', () => {
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
      });
      expect(run.preparation.members).toHaveLength(size);
    }
    const mutable = structuredClone(ASHEN_PILGRIMAGE) as ExpeditionDefinition;
    const frozen = createExpeditionRun({
      runId: 'frozen',
      definition: mutable,
      seed: 9,
      preparation: preparation(),
    });
    mutable.name = 'Changed';
    mutable.riskProfiles[0]!.pendingLootLossPercent = 100;
    expect(frozen.definitionSnapshot.name).toBe('Popielna Pielgrzymka');
    expect(frozen.riskSnapshot.pendingLootLossPercent).toBe(40);
    expect(frozen.preparation.members[0]!.loadout.skillKeys).toEqual([
      'warrior-shield-bash',
    ]);
  });

  it('replays operation IDs before stale-revision checks', () => {
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
    expect(replay).toEqual(first);
    expect(replay.run.decisions).toHaveLength(1);
  });

  it('requires an immutable ritual choice and applies it to the real encounter', () => {
    let run = reachRitualPreparation();
    expect(() => advanceExpedition(run, {
      operationId: 'advance:without-choice',
      edgeKey: 'begin-ritual-hunt',
      expectedRevision: run.revision,
    })).toThrow('EXPEDITION_RITUAL_CHOICE_REQUIRED');
    ({ run } = chooseRitual(run, {
      operationId: 'ritual:salted-chain',
      choiceKey: 'salted-chain',
      expectedRevision: run.revision,
    }));
    expect(() => chooseRitual(run, {
      operationId: 'ritual:change-choice',
      choiceKey: 'blind-lantern',
      expectedRevision: run.revision,
    })).toThrow('EXPEDITION_RITUAL_ALREADY_CHOSEN');
    const advanced = advanceExpedition(run, {
      operationId: 'advance:ritual-hunt',
      edgeKey: 'begin-ritual-hunt',
      expectedRevision: run.revision,
    });
    expect(advanced.run.pendingEncounter).toMatchObject({
      encounterKey: 'execution-circle',
      variantKey: 'salted-chains',
    });

    const definition = ENCOUNTER_CATALOG.find(
      (entry) => entry.key === 'execution-circle',
    );
    expect(definition).toBeDefined();
    const source = scaleEncounter(definition!, 1);
    const salted = applyExpeditionEncounterVariant(source, 'salted-chains');
    expect(salted.definition.actors[0]!.statScale).toBe(0.9);
    expect(salted.definition.actors[1]!.ai.actionWeights.INTERCEPT).toBe(3);
    expect(salted.definition.telegraphs[0]!.counters).toContain('INTERRUPT');
    const blinded = applyExpeditionEncounterVariant(source, 'blind-lantern');
    expect(blinded.definition.actors[0]!.ai.targetPolicy).toBe('FRONT_LINE');
    expect(blinded.definition.phases[0]!.arenaModifier).toBe('BLIND_LANTERN');
    expect(source.definition.actors[0]!.ai.targetPolicy).toBe('MARKED_OR_EXPOSED');
  });

  it('is deterministic across a deep route and terminal extraction', () => {
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
      return markExtracted(run, {
        operationId: 'extract:deep',
        expectedRevision: run.revision,
        now: '2026-08-02T09:00:00.000Z',
      }).run;
    };
    expect(complete()).toEqual(complete());
    expect(complete().status).toBe('COMPLETED');
  });

  it('keeps secured loot and applies frozen risk plus insurance', () => {
    const uninsured = freshRun();
    uninsured.pendingLoot = [
      { sourceKey: 'silver', category: 'SILVER', silver: 100, core: true },
      {
        sourceKey: 'item',
        category: 'EQUIPMENT',
        itemKey: 'tempered-chitin-buckler',
        quantity: 10,
        core: true,
      },
    ];
    uninsured.securedLoot = [
      { sourceKey: 'secured', category: 'SILVER', silver: 25, core: true },
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

describe('expedition public contract', () => {
  it('hides deterministic internals and conditionally reveals authored routes', () => {
    const ritual = freshRun({ selectedDifficulty: 'RITUAL' });
    const hidden = compileExpeditionView(ritual);
    expect(hidden.availableRoutes[0]).not.toHaveProperty('knownCost');
    expect(hidden.availableRoutes[0]).not.toHaveProperty('scoutHint');
    expect(hidden).not.toHaveProperty('seed');

    ritual.currentNodeKey = 'fork-of-vows';
    const withoutOath = compileExpeditionView(ritual, () => false);
    const withOath = compileExpeditionView(ritual, () => true);
    expect(withoutOath.availableRoutes.map((route) => route.key)).toEqual([
      'hunt-brood',
      'challenge-executioners',
    ]);
    expect(withOath.availableRoutes.map((route) => route.key)).toContain(
      'invoke-ashen-oath',
    );
  });

  it('publishes a final report and replays extraction without duplication', () => {
    let run = freshRun();
    run.currentNodeKey = 'safe-extraction';
    run.visitedNodeKeys.push('safe-extraction');
    run.securedLoot = [
      { sourceKey: 'secured:silver', category: 'SILVER', silver: 20, core: true },
    ];
    run.pendingLoot = [{
      sourceKey: 'pending:item',
      category: 'EQUIPMENT',
      itemKey: 'tempered-chitin-buckler',
      quantity: 1,
      core: true,
    }];
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
    const first = markExtracted(run, {
      operationId: 'extract:idempotent',
      expectedRevision: run.revision,
      now: '2026-08-02T08:11:00.000Z',
    });
    const view = compileExpeditionView(first.run);
    expect(view.finalReport).toMatchObject({
      outcome: 'EXTRACTED',
      completionNodeKey: 'safe-extraction',
      durationMs: 600_000,
      economy: {
        securedSilver: 20,
        pendingItemQuantity: 1,
      },
      contributions: [{
        characterId: run.preparation.members[0]!.characterId,
        score: 145,
        damage: 120,
        protection: 25,
      }],
    });
    expect(markExtracted(first.run, {
      operationId: 'extract:idempotent',
      expectedRevision: 0,
      now: '2030-01-01T00:00:00.000Z',
    })).toEqual(first);
  });

  it('uses broad rotations without removing core rewards', () => {
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
