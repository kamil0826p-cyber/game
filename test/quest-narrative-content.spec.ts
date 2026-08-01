import { describe, expect, it } from 'vitest';
import { createQuestNarrativeProgress } from '../src/modules/narrative/narrative.engine.js';
import type { NarrativeDefinition } from '../src/modules/narrative/narrative.types.js';
import {
  incrementObjectiveProgress,
  parseQuestNarrativeContent,
  parseQuestProgress,
  resolveQuestRewards,
} from '../src/modules/quests/quest.rules.js';

const narrative: NarrativeDefinition = {
  key: 'reactive-rabbit-hunt',
  version: 2,
  startNodeKey: 'hunt',
  repeatability: 'ONCE',
  mutuallyExclusivePathKeys: ['save', 'harvest', 'leave'],
  abandonmentPolicy: { restartMode: 'FROM_START', questItemPolicy: 'RETURN' },
  rewardProfiles: {
    'saved-rabbits': { experience: 100, silver: 20, gold: 0 },
    'harvested-rabbits': { experience: 80, silver: 40, gold: 0 },
  },
  nodes: [
    {
      key: 'hunt',
      chapterKey: 'greenfields',
      objectives: [
        {
          key: 'observe',
          type: 'INVESTIGATE',
          targetKey: 'rabbit-tracks',
          quantity: 1,
          authoritativeEventType: 'CLUE_INSPECTED',
        },
      ],
      nextNodeKey: 'choice',
    },
    {
      key: 'choice',
      chapterKey: 'greenfields',
      choices: [
        { key: 'save', label: 'Save', knownEffects: [], outcomeKey: 'saved' },
        { key: 'harvest', label: 'Harvest', knownEffects: [], outcomeKey: 'harvested' },
        { key: 'leave', label: 'Leave', knownEffects: [], outcomeKey: 'left' },
      ],
    },
  ],
  outcomes: [
    { key: 'saved', terminalState: 'SUCCESS', rewardProfileKey: 'saved-rabbits', effects: [] },
    { key: 'harvested', terminalState: 'PARTIAL_SUCCESS', rewardProfileKey: 'harvested-rabbits', effects: [] },
    { key: 'left', terminalState: 'ABANDONED', effects: [] },
  ],
};

const content = {
  version: 2,
  objectives: [
    {
      id: 'rabbit-kills',
      type: 'KILL_MOB',
      mobKey: 'spawn-rabbit',
      quantity: 2,
      match: 'PREFIX',
      stage: 0,
    },
  ],
  narrative,
};

describe('reactive quest content compatibility', () => {
  it('accepts version-matched content and rejects a mismatched snapshot version', () => {
    expect(parseQuestNarrativeContent(content)?.narrative.key).toBe(narrative.key);
    expect(parseQuestNarrativeContent({ ...content, version: 3 })).toBeUndefined();
  });

  it('preserves the narrative snapshot while legacy objective counters advance', () => {
    const snapshot = createQuestNarrativeProgress(narrative);
    const progress = parseQuestProgress({ counters: {}, stage: 0, narrative: snapshot });
    const next = incrementObjectiveProgress(
      content.objectives,
      progress,
      (step) => step.type === 'KILL_MOB',
    );
    expect(next.counters['rabbit-kills']).toBe(1);
    expect(next.narrative).toEqual(snapshot);
  });


  it('uses the immutable outcome reward profile from the active snapshot', () => {
    const source = structuredClone(narrative);
    const snapshot = createQuestNarrativeProgress(source);
    snapshot.outcomeKey = 'saved';
    snapshot.terminalState = 'SUCCESS';
    source.rewardProfiles!['saved-rabbits']!.silver = 999;

    expect(resolveQuestRewards(
      { experience: 1, silver: 1, gold: 0 },
      { counters: {}, stage: 0, narrative: snapshot },
    )).toEqual({ experience: 100, silver: 20, gold: 0 });
  });

});
