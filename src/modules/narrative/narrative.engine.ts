import { evaluateNarrativeConditions } from './narrative.condition-resolver.js';
import type {
  NarrativeAuthoritativeEvent,
  NarrativeChoiceResult,
  NarrativeConditionContext,
  NarrativeDefinition,
  NarrativeEventResult,
  NarrativeObjectiveDefinition,
  NarrativeTerminalState,
  QuestNarrativeProgress,
} from './narrative.types.js';

export interface PublicNarrativeChoice {
  key: string;
  label: string | { en: string; pl: string };
  knownEffects: NarrativeChoiceResult['knownEffects'];
}

export interface NarrativeChronicleEntry {
  type: 'CHOICE' | 'OUTCOME';
  nodeKey?: string;
  optionKey?: string;
  outcomeKey?: string;
  terminalState?: NarrativeTerminalState;
}

export interface PublicNarrativeView {
  definitionKey: string;
  definitionVersion: number;
  currentNodeKey?: string;
  objectives: Array<{ key: string; type: string; current: number; target: number; completed: boolean }>;
  choices: PublicNarrativeChoice[];
  chronicle: NarrativeChronicleEntry[];
  outcomeKey?: string;
  terminalState?: NarrativeTerminalState;
}

export function createQuestNarrativeProgress(definition: NarrativeDefinition): QuestNarrativeProgress {
  return {
    definitionKey: definition.key,
    definitionVersion: definition.version,
    definitionSnapshot: structuredClone(definition),
    currentNodeKey: definition.startNodeKey,
    choices: {},
    objectiveCounters: {},
    processedEvents: {},
    processedChoices: {},
  };
}

export function compileNarrativeChronicle(progress: QuestNarrativeProgress): NarrativeChronicleEntry[] {
  const entries: NarrativeChronicleEntry[] = Object.values(progress.processedChoices).map((choice) => ({
    type: 'CHOICE',
    nodeKey: choice.nodeKey,
    optionKey: choice.optionKey,
  }));
  if (progress.outcomeKey) {
    entries.push({
      type: 'OUTCOME',
      outcomeKey: progress.outcomeKey,
      terminalState: progress.terminalState,
    });
  }
  return entries;
}

export function compilePublicNarrativeView(
  progress: QuestNarrativeProgress,
  context: NarrativeConditionContext,
): PublicNarrativeView {
  const node = progress.definitionSnapshot.nodes.find((candidate) => candidate.key === progress.currentNodeKey);
  if (!node || progress.terminalState) {
    return {
      definitionKey: progress.definitionKey,
      definitionVersion: progress.definitionVersion,
      objectives: [],
      choices: [],
      chronicle: compileNarrativeChronicle(progress),
      outcomeKey: progress.outcomeKey,
      terminalState: progress.terminalState,
    };
  }
  return {
    definitionKey: progress.definitionKey,
    definitionVersion: progress.definitionVersion,
    currentNodeKey: node.key,
    objectives: (node.objectives ?? []).map((objective) => {
      const current = progress.objectiveCounters[objective.key] ?? 0;
      return { key: objective.key, type: objective.type, current, target: objective.quantity, completed: current >= objective.quantity };
    }),
    choices: (node.choices ?? [])
      .filter((choice) => evaluateNarrativeConditions(choice.conditions, context))
      .map((choice) => ({ key: choice.key, label: choice.label, knownEffects: choice.knownEffects })),
    chronicle: compileNarrativeChronicle(progress),
  };
}

export function applyNarrativeChoice(
  progress: QuestNarrativeProgress,
  operationId: string,
  optionKey: string,
  context: NarrativeConditionContext,
): { progress: QuestNarrativeProgress; result: NarrativeChoiceResult; effects: NarrativeChoiceResult['knownEffects'] } {
  const previous = progress.processedChoices[operationId];
  if (previous) return { progress, result: previous, effects: previous.knownEffects };
  if (progress.terminalState) throw new Error('NARRATIVE_ALREADY_TERMINAL');
  const node = progress.definitionSnapshot.nodes.find((candidate) => candidate.key === progress.currentNodeKey);
  if (!node) throw new Error('NARRATIVE_NODE_NOT_FOUND');
  if (progress.choices[node.key]) throw new Error('NARRATIVE_CHOICE_ALREADY_MADE');
  const choice = (node.choices ?? []).find((candidate) => candidate.key === optionKey);
  if (!choice || !evaluateNarrativeConditions(choice.conditions, context)) throw new Error('NARRATIVE_CHOICE_NOT_AVAILABLE');

  const outcome = choice.outcomeKey
    ? progress.definitionSnapshot.outcomes.find((candidate) => candidate.key === choice.outcomeKey)
    : undefined;
  const result: NarrativeChoiceResult = {
    operationId,
    nodeKey: node.key,
    optionKey,
    knownEffects: choice.knownEffects,
    nextNodeKey: choice.nextNodeKey,
    outcomeKey: outcome?.key,
    terminalState: outcome?.terminalState,
  };
  const next: QuestNarrativeProgress = {
    ...progress,
    choices: { ...progress.choices, [node.key]: optionKey },
    processedChoices: { ...progress.processedChoices, [operationId]: result },
    currentNodeKey: choice.nextNodeKey ?? progress.currentNodeKey,
    outcomeKey: outcome?.key ?? progress.outcomeKey,
    terminalState: outcome?.terminalState ?? progress.terminalState,
  };
  const effects = [...choice.knownEffects, ...(choice.hiddenEffects ?? []), ...(outcome?.effects ?? [])];
  return { progress: next, result, effects };
}

function distance(leftX: number, leftY: number, rightX: number, rightY: number): number {
  return Math.max(Math.abs(leftX - rightX), Math.abs(leftY - rightY));
}

function eventAmount(event: NarrativeAuthoritativeEvent): number {
  return event.type === 'ITEM_CRAFTED' || event.type === 'RESOURCE_CONTRIBUTED' ? event.quantity : 1;
}

function matchesObjective(objective: NarrativeObjectiveDefinition, event: NarrativeAuthoritativeEvent): boolean {
  if (objective.authoritativeEventType !== event.type) return false;
  switch (objective.type) {
    case 'INTERACT_OBJECT': return event.type === 'OBJECT_INTERACTED' && (!objective.targetKey || event.objectKey === objective.targetKey);
    case 'INVESTIGATE': return event.type === 'CLUE_INSPECTED' && (!objective.targetKey || event.clueKey === objective.targetKey);
    case 'DEFEND': return event.type === 'ENCOUNTER_DEFENDED' && (!objective.targetKey || event.encounterKey === objective.targetKey);
    case 'ESCORT': return event.type === 'ESCORT_COMPLETED' && (!objective.targetKey || event.npcKey === objective.targetKey);
    case 'USE_ITEM_AT_LOCATION':
      return event.type === 'ITEM_USED_AT_LOCATION' &&
        (!objective.targetKey || event.itemKey === objective.targetKey) &&
        (!objective.mapKey || event.mapKey === objective.mapKey) &&
        (objective.x === undefined || objective.y === undefined || distance(event.x, event.y, objective.x, objective.y) <= (objective.radius ?? 0));
    case 'PERFORM_RITUAL': return event.type === 'RITUAL_PERFORMED' && (!objective.targetKey || event.ritualKey === objective.targetKey);
    case 'MAKE_CHOICE': return event.type === 'CHOICE_MADE' && (!objective.targetKey || event.choiceKey === objective.targetKey);
    case 'CRAFT_ITEM': return event.type === 'ITEM_CRAFTED' && (!objective.targetKey || event.itemKey === objective.targetKey);
    case 'CONTRIBUTE_RESOURCE':
      return event.type === 'RESOURCE_CONTRIBUTED' &&
        (!objective.targetKey || event.resourceKey === objective.targetKey) &&
        (!objective.mapKey || event.regionKey === objective.mapKey);
    case 'COMPLETE_ENCOUNTER_WITH_CONDITION':
      return event.type === 'ENCOUNTER_COMPLETED' &&
        event.result === 'VICTORY' &&
        (!objective.targetKey || event.encounterKey === objective.targetKey) &&
        (!objective.conditionKey || event.conditionKeys.includes(objective.conditionKey));
    case 'REACH_LOCATION':
      return event.type === 'LOCATION_REACHED' &&
        (!objective.mapKey || event.mapKey === objective.mapKey) &&
        (objective.x === undefined || objective.y === undefined || distance(event.x, event.y, objective.x, objective.y) <= (objective.radius ?? 0));
    case 'SURVIVE': return event.type === 'SURVIVED' && (!objective.targetKey || event.encounterKey === objective.targetKey);
    case 'FAIL_FORWARD': return event.type === 'FAILURE_RESOLVED' && (!objective.targetKey || event.failureKey === objective.targetKey);
  }
}

function nodeCompleted(progress: QuestNarrativeProgress): boolean {
  const node = progress.definitionSnapshot.nodes.find((candidate) => candidate.key === progress.currentNodeKey);
  return Boolean(node && (node.objectives ?? []).length > 0 && (node.objectives ?? []).every((objective) => (progress.objectiveCounters[objective.key] ?? 0) >= objective.quantity));
}

function resolveCompletedNode(progress: QuestNarrativeProgress): QuestNarrativeProgress {
  const node = progress.definitionSnapshot.nodes.find((candidate) => candidate.key === progress.currentNodeKey);
  if (!node || !nodeCompleted(progress)) return progress;
  if (node.terminalOutcomeKey) {
    const outcome = progress.definitionSnapshot.outcomes.find((candidate) => candidate.key === node.terminalOutcomeKey);
    if (!outcome) throw new Error('NARRATIVE_OUTCOME_NOT_FOUND');
    return { ...progress, outcomeKey: outcome.key, terminalState: outcome.terminalState };
  }
  if (node.nextNodeKey) return { ...progress, currentNodeKey: node.nextNodeKey };
  return progress;
}

export function applyAuthoritativeNarrativeEvent(
  progress: QuestNarrativeProgress,
  event: NarrativeAuthoritativeEvent,
): { progress: QuestNarrativeProgress; result: NarrativeEventResult } {
  const previous = progress.processedEvents[event.operationId];
  if (previous) return { progress, result: previous };
  if (progress.terminalState) throw new Error('NARRATIVE_ALREADY_TERMINAL');
  const node = progress.definitionSnapshot.nodes.find((candidate) => candidate.key === progress.currentNodeKey);
  if (!node) throw new Error('NARRATIVE_NODE_NOT_FOUND');
  const counters = { ...progress.objectiveCounters };
  const matchedObjectiveKeys: string[] = [];
  for (const objective of node.objectives ?? []) {
    if (!matchesObjective(objective, event)) continue;
    matchedObjectiveKeys.push(objective.key);
    counters[objective.key] = Math.min(objective.quantity, (counters[objective.key] ?? 0) + eventAmount(event));
  }
  let next = resolveCompletedNode({ ...progress, objectiveCounters: counters });
  const completedObjectiveKeys = (node.objectives ?? [])
    .filter((objective) => (next.objectiveCounters[objective.key] ?? 0) >= objective.quantity)
    .map((objective) => objective.key);
  const result: NarrativeEventResult = {
    operationId: event.operationId,
    matchedObjectiveKeys,
    completedObjectiveKeys,
    nextNodeKey: next.currentNodeKey !== progress.currentNodeKey ? next.currentNodeKey : undefined,
    outcomeKey: next.outcomeKey,
    terminalState: next.terminalState,
  };
  next = { ...next, processedEvents: { ...next.processedEvents, [event.operationId]: result } };
  return { progress: next, result };
}

export function applyFailForward(
  progress: QuestNarrativeProgress,
  operationId: string,
): { progress: QuestNarrativeProgress; result: NarrativeEventResult } {
  const previous = progress.processedEvents[operationId];
  if (previous) return { progress, result: previous };
  if (progress.terminalState) throw new Error('NARRATIVE_ALREADY_TERMINAL');
  const node = progress.definitionSnapshot.nodes.find((candidate) => candidate.key === progress.currentNodeKey);
  if (!node) throw new Error('NARRATIVE_NODE_NOT_FOUND');
  if (!node.failForwardNodeKey) throw new Error('NARRATIVE_FAIL_FORWARD_NOT_AVAILABLE');
  const result: NarrativeEventResult = {
    operationId,
    matchedObjectiveKeys: [],
    completedObjectiveKeys: [],
    nextNodeKey: node.failForwardNodeKey,
  };
  return {
    progress: {
      ...progress,
      currentNodeKey: node.failForwardNodeKey,
      processedEvents: { ...progress.processedEvents, [operationId]: result },
    },
    result,
  };
}

export function parseQuestNarrativeProgress(value: unknown): QuestNarrativeProgress | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Partial<QuestNarrativeProgress>;
  if (
    typeof candidate.definitionKey !== 'string' ||
    !Number.isInteger(candidate.definitionVersion) ||
    typeof candidate.currentNodeKey !== 'string' ||
    !candidate.definitionSnapshot ||
    typeof candidate.definitionSnapshot !== 'object' ||
    !candidate.choices ||
    !candidate.objectiveCounters ||
    !candidate.processedEvents ||
    !candidate.processedChoices
  ) return undefined;
  return candidate as QuestNarrativeProgress;
}
