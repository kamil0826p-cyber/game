import { describe, expect, it } from 'vitest';
import {
  evaluateNarrativeCondition,
  resolveNarrativeDialogueRoot,
} from '../src/modules/narrative/narrative.condition-resolver.js';
import {
  applyAuthoritativeNarrativeEvent,
  applyFailForward,
  applyNarrativeChoice,
  compilePublicNarrativeView,
  createQuestNarrativeProgress,
} from '../src/modules/narrative/narrative.engine.js';
import {
  applyNarrativeEffects,
  applyRegionContribution,
  emptyCharacterNarrativeState,
  emptyRegionNarrativeState,
} from '../src/modules/narrative/narrative.state.js';
import type {
  NarrativeConditionContext,
  NarrativeDefinition,
} from '../src/modules/narrative/narrative.types.js';
import {
  diffNarrativeDefinitions,
  planNarrativeSnapshotMigration,
} from '../src/modules/narrative/narrative.authoring.js';
import { validateNarrativeDefinition } from '../src/modules/narrative/narrative.validator.js';

const definition: NarrativeDefinition = {
  key: 'ashes-of-greenfields',
  version: 3,
  startNodeKey: 'investigate',
  repeatability: 'ONCE',
  mutuallyExclusivePathKeys: ['wardens', 'covenant', 'self'],
  rewardProfiles: {
    'ashes-wardens': { experience: 100, silver: 20, gold: 0 },
    'ashes-covenant': { experience: 80, silver: 30, gold: 0 },
    'ashes-self': { experience: 60, silver: 40, gold: 0 },
  },
  nodes: [
    {
      key: 'investigate', chapterKey: 'ashes', failForwardNodeKey: 'debt',
      objectives: [{ key: 'clue', type: 'INVESTIGATE', targetKey: 'black-ash', quantity: 2, authoritativeEventType: 'CLUE_INSPECTED' }],
      onCompleteEffects: [{ type: 'SET_FLAG', operationKey: 'node:investigate:completed', flagKey: 'investigated-black-ash', value: true, reason: 'OBJECTIVES_COMPLETED' }],
      nextNodeKey: 'decision',
    },
    {
      key: 'decision', chapterKey: 'ashes',
      choices: [
        { key: 'wardens', label: 'Oddaj popiół straży.', conditions: [{ type: 'FACTION_REPUTATION', factionKey: 'wardens', comparison: 'GTE', value: 0 }], knownEffects: [{ type: 'ADJUST_REPUTATION', operationKey: 'choice:wardens:reputation', factionKey: 'wardens', delta: 20, sourceKey: 'ashes-choice', reason: 'CHOICE' }], hiddenEffects: [{ type: 'SET_FLAG', operationKey: 'choice:wardens:flag', flagKey: 'ashes-owner', value: 'wardens', reason: 'CHOICE' }], outcomeKey: 'wardens-win' },
        { key: 'covenant', label: 'Zanieś popiół przymierzu.', knownEffects: [{ type: 'ADJUST_REPUTATION', operationKey: 'choice:covenant:reputation', factionKey: 'covenant', delta: 20, sourceKey: 'ashes-choice', reason: 'CHOICE' }], outcomeKey: 'covenant-win' },
        { key: 'self', label: 'Zachowaj popiół.', knownEffects: [{ type: 'SET_FLAG', operationKey: 'choice:self:flag', flagKey: 'kept-black-ash', value: true, reason: 'CHOICE' }], outcomeKey: 'self-win' },
      ],
    },
    { key: 'debt', chapterKey: 'ashes', terminalOutcomeKey: 'failure-debt' },
  ],
  outcomes: [
    { key: 'wardens-win', terminalState: 'SUCCESS', rewardProfileKey: 'ashes-wardens', effects: [{ type: 'SET_FLAG', operationKey: 'outcome:wardens:resolved', flagKey: 'wardens-resolved-ashes', value: true, reason: 'OUTCOME' }] },
    { key: 'covenant-win', terminalState: 'PARTIAL_SUCCESS', rewardProfileKey: 'ashes-covenant', effects: [] },
    { key: 'self-win', terminalState: 'SUCCESS', rewardProfileKey: 'ashes-self', effects: [] },
    { key: 'failure-debt', terminalState: 'FAILURE', effects: [{ type: 'ADJUST_RELATION', operationKey: 'outcome:failure:debt', npcKey: 'mira', dimension: 'DEBT', delta: 10, reason: 'FAIL_FORWARD' }] },
  ],
};

const context = (): NarrativeConditionContext => ({
  level: 10,
  characterClass: 'WARRIOR',
  inventory: new Map(),
  partySize: 1,
  character: emptyCharacterNarrativeState(),
  regionValues: new Map(),
  worldCycles: new Map(),
  encounterResults: new Map(),
});

describe('reactive narrative definitions', () => {
  it('validates three exclusive outcomes and rejects unreachable or double-reward branches', () => {
    expect(validateNarrativeDefinition(definition)).toEqual({ valid: true, issues: [] });
    const invalid: NarrativeDefinition = {
      ...definition,
      nodes: [...definition.nodes, { key: 'orphan', chapterKey: 'ashes', nextNodeKey: 'orphan' }],
      outcomes: definition.outcomes.map((outcome, index) => index === 1 ? { ...outcome, rewardProfileKey: 'ashes-wardens' } : outcome),
    };
    const issues = validateNarrativeDefinition(invalid).issues.map((issue) => issue.code);
    expect(issues).toContain('UNREACHABLE_NODE');
    expect(issues).toContain('NO_TERMINAL_PATH');
    expect(issues).toContain('DOUBLE_TERMINAL_REWARD');
  });



  it('rejects hidden mechanical costs and operation keys that cannot fit persistence policies', () => {
    const hiddenCost: NarrativeDefinition = structuredClone(definition);
    hiddenCost.nodes[1]!.choices![0]!.hiddenEffects = [
      {
        type: 'TAKE_RESOURCE',
        operationKey: 'hidden:take:silver',
        resourceKey: 'SILVER',
        amount: 10,
        reason: 'HIDDEN_COST',
      },
    ];
    expect(validateNarrativeDefinition(hiddenCost).issues.map((issue) => issue.code)).toContain('INVALID_DEFINITION');

    const oversizedOperation: NarrativeDefinition = structuredClone(definition);
    oversizedOperation.nodes[1]!.choices![0]!.knownEffects = [
      {
        type: 'SET_FLAG',
        operationKey: 'x'.repeat(81),
        flagKey: 'oversized-operation',
        value: true,
        reason: 'TEST',
      },
    ];
    expect(validateNarrativeDefinition(oversizedOperation).issues.map((issue) => issue.code)).toContain('MISSING_OPERATION_KEY');

    const unsupportedEffect: NarrativeDefinition = structuredClone(definition);
    unsupportedEffect.nodes[1]!.choices![0]!.knownEffects = [
      {
        type: 'ACTIVATE_ENCOUNTER',
        operationKey: 'encounter:activate',
        encounterKey: 'unwired-encounter',
        reason: 'TEST',
      },
    ];
    expect(validateNarrativeDefinition(unsupportedEffect).issues.map((issue) => issue.code)).toContain('INVALID_DEFINITION');
  });

  it('fails closed for unknown runtime conditions and resolves the highest eligible dialogue root', () => {
    const resolved = context();
    expect(evaluateNarrativeCondition({ type: 'SQL' } as never, resolved)).toBe(false);
    const malformed = structuredClone(definition) as NarrativeDefinition;
    malformed.nodes[0]!.conditions = [{ type: 'SQL' } as never];
    expect(validateNarrativeDefinition(malformed).issues.map((issue) => issue.code)).toContain('INVALID_DEFINITION');

    expect(resolveNarrativeDialogueRoot([
      { key: 'fallback', nodeId: 'fallback-node', priority: 1, conditions: [] },
      { key: 'trusted', nodeId: 'trusted-node', priority: 10, conditions: [{ type: 'LEVEL_AT_LEAST', level: 5 }] },
      { key: 'blocked', nodeId: 'blocked-node', priority: 20, conditions: [{ type: 'LEVEL_AT_LEAST', level: 99 }] },
    ], resolved)?.nodeId).toBe('trusted-node');
  });

  it('detects nested content changes and dry-runs active snapshot migration', () => {
    const progress = createQuestNarrativeProgress(definition);
    const next = structuredClone(definition);
    next.version = 4;
    next.nodes[0]!.objectives![0]!.quantity = 3;
    next.rewardProfiles!['ashes-wardens']!.silver = 21;
    const diff = diffNarrativeDefinitions(definition, next);
    expect(diff.changedNodes).toEqual(['investigate']);
    expect(diff.changedRewardProfiles).toEqual(['ashes-wardens']);
    expect(diff.breaking).toBe(true);
    expect(planNarrativeSnapshotMigration(progress, next)).toMatchObject({
      compatible: true,
      fromVersion: 3,
      toVersion: 4,
    });

    const breaking = structuredClone(next);
    breaking.nodes = breaking.nodes.filter((node) => node.key !== 'investigate');
    expect(planNarrativeSnapshotMigration(progress, breaking).reasons).toContain('CURRENT_NODE_REMOVED');
  });

  it('keeps a versioned definition snapshot on active progress', () => {
    const source = structuredClone(definition);
    const progress = createQuestNarrativeProgress(source);
    source.version = 99;
    expect(progress.definitionVersion).toBe(3);
    expect(progress.definitionSnapshot.version).toBe(3);
  });
});

describe('authoritative progress and choices', () => {
  it('counts only matching authoritative events and makes retries idempotent', () => {
    let progress = createQuestNarrativeProgress(definition);
    const first = applyAuthoritativeNarrativeEvent(progress, { type: 'CLUE_INSPECTED', operationId: 'event-1', clueKey: 'black-ash', mapKey: 'greenfields' });
    progress = first.progress;
    expect(first.result.matchedObjectiveKeys).toEqual(['clue']);
    const retry = applyAuthoritativeNarrativeEvent(progress, { type: 'CLUE_INSPECTED', operationId: 'event-1', clueKey: 'black-ash', mapKey: 'greenfields' });
    expect(retry.result).toEqual(first.result);
    const second = applyAuthoritativeNarrativeEvent(progress, { type: 'CLUE_INSPECTED', operationId: 'event-2', clueKey: 'black-ash', mapKey: 'greenfields' });
    expect(second.progress.currentNodeKey).toBe('decision');
    expect(second.effects.map((effect) => effect.operationKey)).toEqual(['node:investigate:completed']);
    const secondRetry = applyAuthoritativeNarrativeEvent(second.progress, { type: 'CLUE_INSPECTED', operationId: 'event-2', clueKey: 'black-ash', mapKey: 'greenfields' });
    expect(secondRetry.effects).toEqual([]);
  });

  it('records a choice once and exposes no hidden effect or future branch in the public view', () => {
    let progress = createQuestNarrativeProgress(definition);
    progress = applyAuthoritativeNarrativeEvent(progress, { type: 'CLUE_INSPECTED', operationId: 'event-1', clueKey: 'black-ash', mapKey: 'greenfields' }).progress;
    progress = applyAuthoritativeNarrativeEvent(progress, { type: 'CLUE_INSPECTED', operationId: 'event-2', clueKey: 'black-ash', mapKey: 'greenfields' }).progress;
    const view = compilePublicNarrativeView(progress, context());
    expect(view.choices).toHaveLength(3);
    expect(JSON.stringify(view)).not.toContain('choice:wardens:flag');
    const chosen = applyNarrativeChoice(progress, 'choice-request-1', 'wardens', context());
    const retry = applyNarrativeChoice(chosen.progress, 'choice-request-1', 'wardens', context());
    expect(retry.result).toEqual(chosen.result);
    expect(retry.effects).toEqual([]);
    expect(chosen.result.terminalState).toBe('SUCCESS');
    expect(chosen.effects.map((effect) => effect.operationKey)).toEqual([
      'choice:wardens:reputation',
      'choice:wardens:flag',
      'outcome:wardens:resolved',
    ]);
    expect(compilePublicNarrativeView(chosen.progress, context()).chronicle).toEqual([
      { type: 'CHOICE', nodeKey: 'decision', optionKey: 'wardens' },
      { type: 'OUTCOME', outcomeKey: 'wardens-win', terminalState: 'SUCCESS' },
    ]);
  });

  it('moves failure to an alternative stage instead of resetting the story', () => {
    const progress = createQuestNarrativeProgress(definition);
    const failed = applyFailForward(progress, 'failure-resolution-1');
    expect(failed.progress.currentNodeKey).toBe('debt');
    expect(failed.progress.definitionVersion).toBe(3);
    expect(failed.result.terminalState).toBe('FAILURE');
    expect(failed.effects.map((effect) => effect.operationKey)).toEqual(['outcome:failure:debt']);
    const retry = applyFailForward(failed.progress, 'failure-resolution-1');
    expect(retry.result).toEqual(failed.result);
    expect(retry.effects).toEqual([]);
  });
});

describe('relations, factions and region state', () => {
  it('caps audited relations and applies diminishing returns plus hostility cost', () => {
    const state = emptyCharacterNarrativeState();
    state.npcRelations.mira = { TRUST: 95, FEAR: 0, DEBT: 0, GRUDGE: 0 };
    state.factionReputations.wardens = { value: 70, sourceCounts: { repeatable: 3 }, tags: [] };
    state.factionReputations.covenant = { value: 70, sourceCounts: {}, tags: [] };
    const applied = applyNarrativeEffects(state, [
      { type: 'ADJUST_RELATION', operationKey: 'relation-1', npcKey: 'mira', dimension: 'TRUST', delta: 20, reason: 'QUEST' },
      { type: 'ADJUST_REPUTATION', operationKey: 'reputation-1', factionKey: 'wardens', delta: 30, sourceKey: 'repeatable', reason: 'QUEST' },
    ], new Map([['wardens', { key: 'wardens', hostileWith: ['covenant'], mutualPositiveCap: 50 }]]));
    expect(applied.state.npcRelations.mira?.TRUST).toBe(100);
    expect(applied.state.factionReputations.wardens?.value).toBe(85);
    expect(applied.state.factionReputations.covenant?.value).toBe(55);
    expect(applied.audits.every((audit) => audit.reason.length > 0)).toBe(true);
  });

  it('rejects AFK/spam, caps qualified contribution and replays the same result', () => {
    const policy = { minimumMeaningfulAmount: 2, perCharacterCap: 10, perGroupCap: 20, perGuildCap: 30 };
    const afk = applyRegionContribution(emptyRegionNarrativeState(), { operationId: 'region-afk', characterId: 'c1', valueKey: 'ritual', amount: 5, qualified: true, afk: true, reason: 'EVENT' }, policy);
    expect(afk.result.accepted).toBe(false);
    const accepted = applyRegionContribution(emptyRegionNarrativeState(), { operationId: 'region-1', characterId: 'c1', groupId: 'g1', guildId: 'guild1', valueKey: 'ritual', amount: 15, qualified: true, afk: false, reason: 'EVENT' }, policy);
    expect(accepted.result.appliedAmount).toBe(10);
    const replay = applyRegionContribution(accepted.state, { operationId: 'region-1', characterId: 'c1', groupId: 'g1', guildId: 'guild1', valueKey: 'ritual', amount: 999, qualified: true, afk: false, reason: 'REPLAY' }, policy);
    expect(replay.result).toEqual(accepted.result);
  });
});

describe('shared condition resolver', () => {
  it('resolves consequences, guild, relation and region conditions through one evaluator', () => {
    const resolved = context();
    resolved.character.consequences.corruption = 45;
    resolved.character.guild = { role: 'OFFICER' };
    resolved.character.npcRelations.mira = { TRUST: 25, FEAR: 0, DEBT: 0, GRUDGE: 0 };
    resolved.character.factionReputations.wardens = { value: 30, sourceCounts: {}, tags: ['ally'] };
    resolved.regionValues = new Map([['greenfields', new Map([['threat', 80]])]]);
    resolved.regionContributions = new Map([['greenfields', 12]]);
    expect(evaluateNarrativeCondition({ type: 'ALL', conditions: [
      { type: 'CONSEQUENCE', kind: 'CORRUPTION', comparison: 'GTE', value: 40 },
      { type: 'GUILD_ROLE', role: 'OFFICER' },
      { type: 'NPC_RELATION', npcKey: 'mira', dimension: 'TRUST', comparison: 'GTE', value: 20 },
      { type: 'REGION_VALUE', regionKey: 'greenfields', valueKey: 'threat', comparison: 'GTE', value: 50 },
    ] }, resolved)).toBe(true);
    const view = compilePublicNarrativeView(createQuestNarrativeProgress(definition), resolved);
    expect(view.relations).toEqual([{ npcKey: 'mira', trust: 25, fear: 0, debt: 0, grudge: 0 }]);
    expect(view.reputations).toEqual([{ factionKey: 'wardens', value: 30, tags: ['ally'] }]);
    expect(view.regions).toEqual([{ regionKey: 'greenfields', values: { threat: 80 }, characterContribution: 12 }]);
  });
});
