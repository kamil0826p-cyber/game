import { z } from 'zod';
import type { SupportedLocale } from '../../i18n/localization.service.js';
import { parseQuestNarrativeProgress } from '../narrative/narrative.engine.js';
import type { NarrativeDefinition, QuestNarrativeProgress } from '../narrative/narrative.types.js';
import { parseNarrativeDefinition } from '../narrative/narrative.validator.js';

const identifierSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const keySchema = z.string().trim().min(1).max(96).regex(/^[a-z0-9-]+$/);
const localizedTextSchema = z.union([
  z.string().trim().min(1).max(500),
  z.object({ en: z.string().trim().min(1).max(500), pl: z.string().trim().min(1).max(500) }).strict(),
]);
const baseStepSchema = z.object({
  id: identifierSchema,
  label: localizedTextSchema.optional(),
  stage: z.number().int().min(0).max(1_000).default(0),
});
const collectItemStepSchema = baseStepSchema.extend({
  type: z.literal('COLLECT_ITEM'),
  itemKey: keySchema,
  quantity: z.number().int().min(1).max(100_000),
  consumeOnComplete: z.boolean().default(true),
}).strict();
const killMobStepSchema = baseStepSchema.extend({
  type: z.literal('KILL_MOB'),
  mobKey: keySchema,
  quantity: z.number().int().min(1).max(100_000),
  match: z.enum(['EXACT', 'PREFIX']).default('EXACT'),
}).strict();
const talkToNpcStepSchema = baseStepSchema.extend({
  type: z.literal('TALK_TO_NPC'),
  npcKey: keySchema,
  quantity: z.number().int().min(1).max(100).default(1),
}).strict();

export const questStepsSchema = z.array(z.discriminatedUnion('type', [
  collectItemStepSchema,
  killMobStepSchema,
  talkToNpcStepSchema,
])).min(1).max(64).superRefine((steps, context) => {
  const ids = new Set<string>();
  for (const [index, step] of steps.entries()) {
    if (ids.has(step.id)) context.addIssue({ code: 'custom', path: [index, 'id'], message: `Duplicate quest step id: ${step.id}` });
    ids.add(step.id);
  }
});

const reactiveQuestContentSchema = z.object({
  version: z.number().int().min(1).max(2_147_483_647),
  objectives: questStepsSchema,
  narrative: z.unknown(),
}).strict();

export const questRewardsSchema = z.object({
  experience: z.number().int().min(0).max(2_147_483_647).default(0),
  gold: z.literal(0).default(0),
  silver: z.number().int().min(0).max(2_147_483_647).default(0),
}).strict().refine((reward) => reward.experience > 0 || reward.silver > 0, {
  message: 'A quest must award experience or silver. Gold is premium currency and cannot be awarded by quests.',
});

export type QuestStepDefinition = z.infer<typeof questStepsSchema>[number];
export type QuestRewards = z.infer<typeof questRewardsSchema>;
export interface QuestProgressState {
  counters: Record<string, number>;
  stage: number;
  narrative?: QuestNarrativeProgress;
}
export interface QuestNarrativeContent { version: number; objectives: QuestStepDefinition[]; narrative: NarrativeDefinition; }
export interface EvaluatedQuestStep {
  id: string;
  type: QuestStepDefinition['type'];
  label: string;
  stage: number;
  active: boolean;
  current: number;
  target: number;
  completed: boolean;
}

const questStages = (steps: readonly QuestStepDefinition[]): number[] =>
  [...new Set(steps.map((step) => step.stage))].sort((left, right) => left - right);

const normalizedStage = (steps: readonly QuestStepDefinition[], requestedStage: number): number => {
  const stages = questStages(steps);
  if (stages.length === 0) return 0;
  return stages.find((stage) => stage >= requestedStage) ?? stages[stages.length - 1]! + 1;
};

const rawStepCurrent = (
  step: QuestStepDefinition,
  progress: QuestProgressState,
  inventoryCounts: ReadonlyMap<string, number>,
): number => step.type === 'COLLECT_ITEM'
  ? inventoryCounts.get(step.itemKey) ?? 0
  : progress.counters[step.id] ?? 0;

const preserveNarrative = (progress: QuestProgressState): Pick<QuestProgressState, 'narrative'> =>
  progress.narrative ? { narrative: progress.narrative } : {};

export const emptyQuestProgress = (steps: readonly QuestStepDefinition[] = []): QuestProgressState => ({
  counters: {},
  stage: questStages(steps)[0] ?? 0,
});

export function parseQuestNarrativeContent(value: unknown): QuestNarrativeContent | undefined {
  const parsed = reactiveQuestContentSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const narrative = parseNarrativeDefinition(parsed.data.narrative);
  if (!narrative || narrative.version !== parsed.data.version) return undefined;
  return { version: parsed.data.version, objectives: parsed.data.objectives, narrative };
}

export function parseQuestSteps(value: unknown): QuestStepDefinition[] | undefined {
  const direct = questStepsSchema.safeParse(value);
  if (direct.success) return direct.data;
  return parseQuestNarrativeContent(value)?.objectives;
}

export function parseQuestRewards(value: unknown): QuestRewards | undefined {
  const parsed = questRewardsSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function resolveQuestRewards(
  fallback: QuestRewards,
  progress: QuestProgressState,
): QuestRewards | undefined {
  const snapshot = progress.narrative?.definitionSnapshot;
  const outcome = snapshot?.outcomes.find(
    (candidate) => candidate.key === progress.narrative?.outcomeKey,
  );
  if (!outcome?.rewardProfileKey) return fallback;
  return snapshot?.rewardProfiles?.[outcome.rewardProfileKey];
}

export function parseQuestProgress(value: unknown): QuestProgressState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyQuestProgress();
  const source = value as { counters?: unknown; stage?: unknown; narrative?: unknown };
  const counters: Record<string, number> = {};
  if (source.counters && typeof source.counters === 'object' && !Array.isArray(source.counters)) {
    for (const [key, counter] of Object.entries(source.counters)) {
      if (Number.isInteger(counter) && Number(counter) >= 0) counters[key] = Number(counter);
    }
  }
  const stage = Number.isInteger(source.stage) && Number(source.stage) >= 0 ? Number(source.stage) : 0;
  const narrative = parseQuestNarrativeProgress(source.narrative);
  return { counters, stage, ...(narrative ? { narrative } : {}) };
}

export function localizeQuestText(value: string | { en: string; pl: string } | undefined, locale: SupportedLocale, fallback: string): string {
  if (!value) return fallback;
  return typeof value === 'string' ? value : value[locale];
}

export function getActiveQuestStage(
  steps: readonly QuestStepDefinition[],
  progress: QuestProgressState,
): number | undefined {
  const stages = questStages(steps);
  if (stages.length === 0) return undefined;
  const stage = normalizedStage(steps, progress.stage);
  return stage > stages[stages.length - 1]! ? undefined : stage;
}

export function advanceQuestProgress(
  steps: readonly QuestStepDefinition[],
  progress: QuestProgressState,
  inventoryCounts: ReadonlyMap<string, number>,
): QuestProgressState {
  const stages = questStages(steps);
  if (stages.length === 0) return { counters: { ...progress.counters }, stage: 0, ...preserveNarrative(progress) };
  let stage = normalizedStage(steps, progress.stage);
  while (stage <= stages[stages.length - 1]!) {
    const currentSteps = steps.filter((step) => step.stage === stage);
    if (!currentSteps.every((step) => rawStepCurrent(step, progress, inventoryCounts) >= step.quantity)) break;
    stage = stages.find((candidate) => candidate > stage) ?? stages[stages.length - 1]! + 1;
  }
  return { counters: { ...progress.counters }, stage, ...preserveNarrative(progress) };
}

export function reconcileQuestProgress(
  steps: readonly QuestStepDefinition[],
  progress: QuestProgressState,
  inventoryCounts: ReadonlyMap<string, number>,
): QuestProgressState {
  const advanced = advanceQuestProgress(steps, progress, inventoryCounts);
  const cumulativeRequirements = new Map<string, number>();
  for (const stage of questStages(steps)) {
    if (stage >= advanced.stage) break;
    for (const step of steps) {
      if (step.stage !== stage || step.type !== 'COLLECT_ITEM' || !step.consumeOnComplete) continue;
      cumulativeRequirements.set(step.itemKey, (cumulativeRequirements.get(step.itemKey) ?? 0) + step.quantity);
    }
    for (const [itemKey, requiredQuantity] of cumulativeRequirements) {
      if ((inventoryCounts.get(itemKey) ?? 0) < requiredQuantity) {
        return { counters: { ...advanced.counters }, stage, ...preserveNarrative(advanced) };
      }
    }
  }
  return advanced;
}

export function evaluateQuestSteps(
  steps: readonly QuestStepDefinition[],
  progress: QuestProgressState,
  inventoryCounts: ReadonlyMap<string, number>,
  locale: SupportedLocale,
): EvaluatedQuestStep[] {
  const activeStage = getActiveQuestStage(steps, progress);
  return steps.map((step) => {
    const completedStage = activeStage === undefined || step.stage < activeStage;
    const active = step.stage === activeStage;
    const rawCurrent = active ? rawStepCurrent(step, progress, inventoryCounts) : completedStage ? step.quantity : 0;
    const target = step.quantity;
    const fallback = step.type === 'COLLECT_ITEM'
      ? (locale === 'pl' ? `Zdobądź przedmiot: ${step.itemKey}` : `Collect item: ${step.itemKey}`)
      : step.type === 'KILL_MOB'
        ? (locale === 'pl' ? `Pokonaj przeciwnika: ${step.mobKey}` : `Defeat enemy: ${step.mobKey}`)
        : (locale === 'pl' ? `Porozmawiaj z: ${step.npcKey}` : `Talk to: ${step.npcKey}`);
    return {
      id: step.id,
      type: step.type,
      label: localizeQuestText(step.label, locale, fallback),
      stage: step.stage,
      active,
      current: Math.min(rawCurrent, target),
      target,
      completed: completedStage || (active && rawCurrent >= target),
    };
  });
}

export const areQuestStepsComplete = (steps: readonly EvaluatedQuestStep[]): boolean =>
  steps.length > 0 && steps.every((step) => step.completed);

export function consumableRequirements(steps: readonly QuestStepDefinition[]): Map<string, number> {
  const required = new Map<string, number>();
  for (const step of steps) {
    if (step.type !== 'COLLECT_ITEM' || !step.consumeOnComplete) continue;
    required.set(step.itemKey, (required.get(step.itemKey) ?? 0) + step.quantity);
  }
  return required;
}

export function matchesMobStep(step: QuestStepDefinition, mobDefinitionKey: string): boolean {
  if (step.type !== 'KILL_MOB') return false;
  return step.match === 'PREFIX' ? mobDefinitionKey.startsWith(step.mobKey) : mobDefinitionKey === step.mobKey;
}

export function incrementObjectiveProgress(
  steps: readonly QuestStepDefinition[],
  progress: QuestProgressState,
  predicate: (step: QuestStepDefinition) => boolean,
): QuestProgressState {
  const counters = { ...progress.counters };
  const activeStage = getActiveQuestStage(steps, progress);
  if (activeStage === undefined) return { counters, stage: progress.stage, ...preserveNarrative(progress) };
  for (const step of steps) {
    if (step.stage !== activeStage || step.type === 'COLLECT_ITEM' || !predicate(step)) continue;
    counters[step.id] = Math.min(step.quantity, (counters[step.id] ?? 0) + 1);
  }
  return { counters, stage: progress.stage, ...preserveNarrative(progress) };
}
