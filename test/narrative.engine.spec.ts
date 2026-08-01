import { describe, expect, it } from 'vitest';
import { evaluateNarrativeCondition } from '../src/modules/narrative/narrative.condition-resolver.js';
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
import { validateNarrativeDefinition } from '../src/modules/narrative/narrative.validator.js';

const definition: NarrativeDefinition = {
  key: 'ashes-of-greenfields',
  version: 3,
  startNodeKey: 'investigate',
  repeatability: 'ONCE',
  mutuallyExclusivePathKeys: ['wardens', 'covenant', 'self'],
  nodes: [
    {
      key: 'investigate', chapterKey: 'ashes', failForwardNodeKey: 'debt',
      objectives: [{ key: 'clue', type: 'INVESTIGATE', targetKey: 'black-ash', quantity: 2, authoritativeEventType: 'CLUE_INSPECTED' }],
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
    { key: 'wardens-win', terminalState: 'SUCCESS', rewardProfileKey: 'ashes-wardens', effects: [] },
    { key: 'covenant-win', terminalState: 'PARTIAL_SUCCESS', rewardProfileKey: 'ashes-covenant', effects: [] },
    { key: 'self-win', terminalState: 'SUCCESS', rewardProfileKey: 'ashes-self', effects: [] },
    { key: 'failure-debt', terminalState: 'FAILURE', effects: [] },
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
    expect(chosen.result.terminalState).toBe('SUCCESS');
    expect(chosen.effects.map((effect) => effect.operationKey)).toContain('choice:wardens:flag');
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
    expect(applyFailForward(failed.progress, 'failure-resolution-1').result).toEqual(failed.result);
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
    resolved.regionValues = new Map([['greenfields', new Map([['threat', 80]])]]);
    expect(evaluateNarrativeCondition({ type: 'ALL', conditions: [
      { type: 'CONSEQUENCE', kind: 'CORRUPTION', comparison: 'GTE', value: 40 },
      { type: 'GUILD_ROLE', role: 'OFFICER' },
      { type: 'NPC_RELATION', npcKey: 'mira', dimension: 'TRUST', comparison: 'GTE', value: 20 },
      { type: 'REGION_VALUE', regionKey: 'greenfields', valueKey: 'threat', comparison: 'GTE', value: 50 },
    ] }, resolved)).toBe(true);
  });
});
