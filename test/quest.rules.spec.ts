import { describe, expect, it } from 'vitest';
import {
  advanceQuestProgress,
  areQuestStepsComplete,
  consumableRequirements,
  emptyQuestProgress,
  evaluateQuestSteps,
  getActiveQuestStage,
  incrementObjectiveProgress,
  matchesMobStep,
  parseQuestProgress,
  parseQuestRewards,
  parseQuestSteps,
  reconcileQuestProgress,
} from '../src/modules/quests/quest.rules.js';

const collection = parseQuestSteps([{ id: 'fur', type: 'COLLECT_ITEM', itemKey: 'rabbit-fur', quantity: 5, consumeOnComplete: true, label: { pl: 'Zdobądź futra', en: 'Collect furs' } }])!;
describe('quest definition rules', () => {
  it('evaluates collection objectives against authoritative inventory counts', () => {
    const incompleteProgress = reconcileQuestProgress(collection, parseQuestProgress({}), new Map([['rabbit-fur', 4]]));
    const readyProgress = reconcileQuestProgress(collection, parseQuestProgress({}), new Map([['rabbit-fur', 7]]));
    const incomplete = evaluateQuestSteps(collection, incompleteProgress, new Map([['rabbit-fur', 4]]), 'pl');
    const ready = evaluateQuestSteps(collection, readyProgress, new Map([['rabbit-fur', 7]]), 'en');
    expect(incomplete[0]).toMatchObject({ current: 4, target: 5, completed: false, active: true, stage: 0 });
    expect(ready[0]).toMatchObject({ current: 5, target: 5, completed: true, active: false, stage: 0 });
    expect(areQuestStepsComplete(incomplete)).toBe(false); expect(areQuestStepsComplete(ready)).toBe(true);
  });
  it('aggregates consumable item requirements', () => {
    const steps = parseQuestSteps([{ id: 'a', type: 'COLLECT_ITEM', itemKey: 'rabbit-fur', quantity: 2, consumeOnComplete: true }, { id: 'b', type: 'COLLECT_ITEM', itemKey: 'rabbit-fur', quantity: 3, consumeOnComplete: true }])!;
    expect(consumableRequirements(steps)).toEqual(new Map([['rabbit-fur', 5]]));
  });
  it('increments prefix kill objectives without exceeding targets', () => {
    const steps = parseQuestSteps([{ id: 'rabbits', type: 'KILL_MOB', mobKey: 'spawn-rabbit-', match: 'PREFIX', quantity: 2 }])!;
    const once = incrementObjectiveProgress(steps, emptyQuestProgress(steps), (step) => matchesMobStep(step, 'spawn-rabbit-7'));
    const capped = incrementObjectiveProgress(steps, incrementObjectiveProgress(steps, once, (step) => matchesMobStep(step, 'spawn-rabbit-2')), (step) => matchesMobStep(step, 'spawn-rabbit-1'));
    expect(capped.counters).toEqual({ rabbits: 2 });
  });
  it('blocks future objectives until the current stage is complete', () => {
    const steps = parseQuestSteps([
      { id: 'ask-hunter', type: 'TALK_TO_NPC', npcKey: 'hunter', quantity: 1, stage: 0 },
      { id: 'kill-rabbits', type: 'KILL_MOB', mobKey: 'spawn-rabbit', quantity: 2, stage: 1 },
      { id: 'return-mira', type: 'TALK_TO_NPC', npcKey: 'mira-tanner', quantity: 1, stage: 2 },
    ])!;
    const inventory = new Map<string, number>();
    let progress = emptyQuestProgress(steps);

    progress = incrementObjectiveProgress(steps, progress, (step) => matchesMobStep(step, 'spawn-rabbit'));
    expect(progress.counters).toEqual({});
    expect(getActiveQuestStage(steps, progress)).toBe(0);

    progress = incrementObjectiveProgress(steps, progress, (step) => step.type === 'TALK_TO_NPC' && step.npcKey === 'hunter');
    progress = advanceQuestProgress(steps, progress, inventory);
    expect(getActiveQuestStage(steps, progress)).toBe(1);

    progress = incrementObjectiveProgress(steps, progress, (step) => matchesMobStep(step, 'spawn-rabbit'));
    progress = incrementObjectiveProgress(steps, progress, (step) => matchesMobStep(step, 'spawn-rabbit'));
    progress = advanceQuestProgress(steps, progress, inventory);
    expect(getActiveQuestStage(steps, progress)).toBe(2);

    progress = incrementObjectiveProgress(steps, progress, (step) => step.type === 'TALK_TO_NPC' && step.npcKey === 'mira-tanner');
    progress = advanceQuestProgress(steps, progress, inventory);
    expect(getActiveQuestStage(steps, progress)).toBeUndefined();
    expect(areQuestStepsComplete(evaluateQuestSteps(steps, progress, inventory, 'pl'))).toBe(true);
  });
  it('reopens a consumable collection stage when required items are lost', () => {
    const steps = parseQuestSteps([
      { id: 'collect-fur', type: 'COLLECT_ITEM', itemKey: 'rabbit-fur', quantity: 2, consumeOnComplete: true, stage: 0 },
      { id: 'kill-rabbit', type: 'KILL_MOB', mobKey: 'spawn-rabbit', quantity: 1, stage: 1 },
    ])!;
    const completed = { counters: { 'kill-rabbit': 1 }, stage: 2 };
    expect(getActiveQuestStage(steps, reconcileQuestProgress(steps, completed, new Map([['rabbit-fur', 1]])))).toBe(0);
    expect(getActiveQuestStage(steps, reconcileQuestProgress(steps, completed, new Map([['rabbit-fur', 2]])))).toBeUndefined();
  });
  it('keeps objectives in the same stage parallel', () => {
    const steps = parseQuestSteps([
      { id: 'talk-a', type: 'TALK_TO_NPC', npcKey: 'a', quantity: 1 },
      { id: 'talk-b', type: 'TALK_TO_NPC', npcKey: 'b', quantity: 1 },
    ])!;
    let progress = emptyQuestProgress(steps);
    progress = incrementObjectiveProgress(steps, progress, (step) => step.type === 'TALK_TO_NPC' && step.npcKey === 'a');
    progress = advanceQuestProgress(steps, progress, new Map());
    expect(getActiveQuestStage(steps, progress)).toBe(0);
  });
  it('rejects duplicate step ids and empty rewards', () => {
    expect(parseQuestSteps([{ id: 'same', type: 'TALK_TO_NPC', npcKey: 'mira', quantity: 1 }, { id: 'same', type: 'COLLECT_ITEM', itemKey: 'rabbit-fur', quantity: 1 }])).toBeUndefined();
    expect(parseQuestRewards({ experience: 0, gold: 0, silver: 0 })).toBeUndefined();
  });
});
