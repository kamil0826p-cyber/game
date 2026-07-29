import { describe, expect, it } from 'vitest';
import { areQuestStepsComplete, consumableRequirements, evaluateQuestSteps, incrementObjectiveProgress, matchesMobStep, parseQuestProgress, parseQuestRewards, parseQuestSteps } from '../src/modules/quests/quest.rules.js';

const collection = parseQuestSteps([{ id: 'fur', type: 'COLLECT_ITEM', itemKey: 'rabbit-fur', quantity: 5, consumeOnComplete: true, label: { pl: 'Zdobądź futra', en: 'Collect furs' } }])!;
describe('quest definition rules', () => {
  it('evaluates collection objectives against authoritative inventory counts', () => {
    const incomplete = evaluateQuestSteps(collection, parseQuestProgress({}), new Map([['rabbit-fur', 4]]), 'pl');
    const ready = evaluateQuestSteps(collection, parseQuestProgress({}), new Map([['rabbit-fur', 7]]), 'en');
    expect(incomplete[0]).toMatchObject({ current: 4, target: 5, completed: false });
    expect(ready[0]).toMatchObject({ current: 5, target: 5, completed: true });
    expect(areQuestStepsComplete(incomplete)).toBe(false); expect(areQuestStepsComplete(ready)).toBe(true);
  });
  it('aggregates consumable item requirements', () => {
    const steps = parseQuestSteps([{ id: 'a', type: 'COLLECT_ITEM', itemKey: 'rabbit-fur', quantity: 2, consumeOnComplete: true }, { id: 'b', type: 'COLLECT_ITEM', itemKey: 'rabbit-fur', quantity: 3, consumeOnComplete: true }])!;
    expect(consumableRequirements(steps)).toEqual(new Map([['rabbit-fur', 5]]));
  });
  it('increments prefix kill objectives without exceeding targets', () => {
    const steps = parseQuestSteps([{ id: 'rabbits', type: 'KILL_MOB', mobKey: 'spawn-rabbit-', match: 'PREFIX', quantity: 2 }])!;
    const once = incrementObjectiveProgress(steps, parseQuestProgress({}), (step) => matchesMobStep(step, 'spawn-rabbit-7'));
    const capped = incrementObjectiveProgress(steps, incrementObjectiveProgress(steps, once, (step) => matchesMobStep(step, 'spawn-rabbit-2')), (step) => matchesMobStep(step, 'spawn-rabbit-1'));
    expect(capped.counters).toEqual({ rabbits: 2 });
  });
  it('rejects duplicate step ids and empty rewards', () => {
    expect(parseQuestSteps([{ id: 'same', type: 'TALK_TO_NPC', npcKey: 'mira', quantity: 1 }, { id: 'same', type: 'COLLECT_ITEM', itemKey: 'rabbit-fur', quantity: 1 }])).toBeUndefined();
    expect(parseQuestRewards({ experience: 0, gold: 0, silver: 0 })).toBeUndefined();
  });
});
