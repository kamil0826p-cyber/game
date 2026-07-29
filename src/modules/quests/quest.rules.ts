import { z } from 'zod';
import type { SupportedLocale } from '../../i18n/localization.service.js';

const identifierSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const keySchema = z.string().trim().min(1).max(96).regex(/^[a-z0-9-]+$/);
const localizedTextSchema = z.union([
  z.string().trim().min(1).max(500),
  z.object({ en: z.string().trim().min(1).max(500), pl: z.string().trim().min(1).max(500) }).strict(),
]);
const baseStepSchema = z.object({ id: identifierSchema, label: localizedTextSchema.optional() });
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

export const questRewardsSchema = z.object({
  experience: z.number().int().min(0).max(2_147_483_647).default(0),
  gold: z.number().int().min(0).max(2_147_483_647).default(0),
  silver: z.number().int().min(0).max(2_147_483_647).default(0),
}).strict().refine((reward) => reward.experience > 0 || reward.gold > 0 || reward.silver > 0, {
  message: 'A quest must award at least one reward.',
});

export type QuestStepDefinition = z.infer<typeof questStepsSchema>[number];
export type QuestRewards = z.infer<typeof questRewardsSchema>;
export interface QuestProgressState { counters: Record<string, number>; }
export interface EvaluatedQuestStep {
  id: string;
  type: QuestStepDefinition['type'];
  label: string;
  current: number;
  target: number;
  completed: boolean;
}

export const emptyQuestProgress = (): QuestProgressState => ({ counters: {} });

export function parseQuestSteps(value: unknown): QuestStepDefinition[] | undefined {
  const parsed = questStepsSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function parseQuestRewards(value: unknown): QuestRewards | undefined {
  const parsed = questRewardsSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function parseQuestProgress(value: unknown): QuestProgressState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyQuestProgress();
  const raw = (value as { counters?: unknown }).counters;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyQuestProgress();
  const counters: Record<string, number> = {};
  for (const [key, counter] of Object.entries(raw)) {
    if (Number.isInteger(counter) && Number(counter) >= 0) counters[key] = Number(counter);
  }
  return { counters };
}

export function localizeQuestText(value: string | { en: string; pl: string } | undefined, locale: SupportedLocale, fallback: string): string {
  if (!value) return fallback;
  return typeof value === 'string' ? value : value[locale];
}

export function evaluateQuestSteps(
  steps: readonly QuestStepDefinition[],
  progress: QuestProgressState,
  inventoryCounts: ReadonlyMap<string, number>,
  locale: SupportedLocale,
): EvaluatedQuestStep[] {
  return steps.map((step) => {
    const current = step.type === 'COLLECT_ITEM'
      ? inventoryCounts.get(step.itemKey) ?? 0
      : progress.counters[step.id] ?? 0;
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
      current: Math.min(current, target),
      target,
      completed: current >= target,
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
  for (const step of steps) {
    if (step.type === 'COLLECT_ITEM' || !predicate(step)) continue;
    counters[step.id] = Math.min(step.quantity, (counters[step.id] ?? 0) + 1);
  }
  return { counters };
}
