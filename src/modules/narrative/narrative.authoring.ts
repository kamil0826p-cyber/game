import { applyNarrativeChoice, createQuestNarrativeProgress } from './narrative.engine.js';
import type {
  NarrativeConditionContext,
  NarrativeDefinition,
  NarrativeEffect,
  QuestNarrativeProgress,
} from './narrative.types.js';
import { validateNarrativeDefinition, type NarrativeValidationIssue } from './narrative.validator.js';

export interface NarrativeDefinitionDiff {
  fromVersion: number;
  toVersion: number;
  addedNodes: string[];
  removedNodes: string[];
  changedNodes: string[];
  addedOutcomes: string[];
  removedOutcomes: string[];
  changedOutcomes: string[];
  addedRewardProfiles: string[];
  removedRewardProfiles: string[];
  changedRewardProfiles: string[];
  breaking: boolean;
}

export interface NarrativePathSimulation {
  paths: Array<{ choices: string[]; outcomeKey: string; terminalState: string }>;
  truncated: boolean;
  issues: NarrativeValidationIssue[];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

const stableJson = (value: unknown): string => JSON.stringify(canonicalize(value));

export function diffNarrativeDefinitions(
  previous: NarrativeDefinition,
  next: NarrativeDefinition,
): NarrativeDefinitionDiff {
  const previousNodes = new Map(previous.nodes.map((node) => [node.key, node]));
  const nextNodes = new Map(next.nodes.map((node) => [node.key, node]));
  const previousOutcomes = new Map(previous.outcomes.map((outcome) => [outcome.key, outcome]));
  const nextOutcomes = new Map(next.outcomes.map((outcome) => [outcome.key, outcome]));
  const previousRewardProfiles = new Map(Object.entries(previous.rewardProfiles ?? {}));
  const nextRewardProfiles = new Map(Object.entries(next.rewardProfiles ?? {}));
  const addedNodes = [...nextNodes.keys()].filter((key) => !previousNodes.has(key)).sort();
  const removedNodes = [...previousNodes.keys()].filter((key) => !nextNodes.has(key)).sort();
  const changedNodes = [...nextNodes.keys()]
    .filter((key) => previousNodes.has(key) && stableJson(previousNodes.get(key)) !== stableJson(nextNodes.get(key)))
    .sort();
  const addedOutcomes = [...nextOutcomes.keys()].filter((key) => !previousOutcomes.has(key)).sort();
  const removedOutcomes = [...previousOutcomes.keys()].filter((key) => !nextOutcomes.has(key)).sort();
  const changedOutcomes = [...nextOutcomes.keys()]
    .filter((key) => previousOutcomes.has(key) && stableJson(previousOutcomes.get(key)) !== stableJson(nextOutcomes.get(key)))
    .sort();
  const addedRewardProfiles = [...nextRewardProfiles.keys()].filter((key) => !previousRewardProfiles.has(key)).sort();
  const removedRewardProfiles = [...previousRewardProfiles.keys()].filter((key) => !nextRewardProfiles.has(key)).sort();
  const changedRewardProfiles = [...nextRewardProfiles.keys()]
    .filter((key) => previousRewardProfiles.has(key) && stableJson(previousRewardProfiles.get(key)) !== stableJson(nextRewardProfiles.get(key)))
    .sort();
  return {
    fromVersion: previous.version,
    toVersion: next.version,
    addedNodes,
    removedNodes,
    changedNodes,
    addedOutcomes,
    removedOutcomes,
    changedOutcomes,
    addedRewardProfiles,
    removedRewardProfiles,
    changedRewardProfiles,
    breaking:
      next.version <= previous.version ||
      removedNodes.length > 0 ||
      removedOutcomes.length > 0 ||
      removedRewardProfiles.length > 0 ||
      changedRewardProfiles.length > 0 ||
      previous.startNodeKey !== next.startNodeKey,
  };
}

export function simulateNarrativePaths(
  definition: NarrativeDefinition,
  context: NarrativeConditionContext,
  maximumPaths = 1_000,
  maximumDepth = 100,
): NarrativePathSimulation {
  const validation = validateNarrativeDefinition(definition);
  if (!validation.valid) return { paths: [], truncated: false, issues: validation.issues };
  const paths: NarrativePathSimulation['paths'] = [];
  const queue: Array<{ nodeKey: string; choices: string[]; depth: number }> = [
    { nodeKey: definition.startNodeKey, choices: [], depth: 0 },
  ];
  let truncated = false;
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maximumDepth || paths.length >= maximumPaths) {
      truncated = true;
      break;
    }
    const node = definition.nodes.find((candidate) => candidate.key === current.nodeKey);
    if (!node) continue;
    if (node.terminalOutcomeKey) {
      const outcome = definition.outcomes.find((candidate) => candidate.key === node.terminalOutcomeKey);
      if (outcome) paths.push({ choices: current.choices, outcomeKey: outcome.key, terminalState: outcome.terminalState });
      continue;
    }
    if (node.choices?.length) {
      for (const choice of node.choices) {
        try {
          const progress = createQuestNarrativeProgress({ ...definition, startNodeKey: node.key });
          const result = applyNarrativeChoice(progress, `simulation:${current.depth}:${choice.key}`, choice.key, context);
          if (result.result.outcomeKey && result.result.terminalState) {
            paths.push({ choices: [...current.choices, choice.key], outcomeKey: result.result.outcomeKey, terminalState: result.result.terminalState });
          } else if (result.result.nextNodeKey) {
            queue.push({ nodeKey: result.result.nextNodeKey, choices: [...current.choices, choice.key], depth: current.depth + 1 });
          }
        } catch {
          // An unavailable choice is intentionally absent from this context-specific simulation.
        }
      }
      continue;
    }
    if (node.nextNodeKey) queue.push({ nodeKey: node.nextNodeKey, choices: current.choices, depth: current.depth + 1 });
    if (node.failForwardNodeKey) queue.push({ nodeKey: node.failForwardNodeKey, choices: [...current.choices, '$FAIL_FORWARD'], depth: current.depth + 1 });
  }
  return { paths, truncated, issues: [] };
}



export interface NarrativeMigrationPlan {
  definitionKey: string;
  fromVersion: number;
  toVersion: number;
  compatible: boolean;
  reasons: string[];
  diff: NarrativeDefinitionDiff;
}

export function planNarrativeSnapshotMigration(
  progress: QuestNarrativeProgress,
  nextDefinition: NarrativeDefinition,
): NarrativeMigrationPlan {
  const reasons: string[] = [];
  const validation = validateNarrativeDefinition(nextDefinition);
  if (!validation.valid) reasons.push('TARGET_DEFINITION_INVALID');
  if (progress.definitionKey !== nextDefinition.key) reasons.push('DEFINITION_KEY_CHANGED');
  if (nextDefinition.version <= progress.definitionVersion) reasons.push('TARGET_VERSION_NOT_NEWER');
  const nodes = new Map(nextDefinition.nodes.map((node) => [node.key, node]));
  if (!nodes.has(progress.currentNodeKey)) reasons.push('CURRENT_NODE_REMOVED');
  if (progress.outcomeKey && !nextDefinition.outcomes.some((outcome) => outcome.key === progress.outcomeKey)) {
    reasons.push('TERMINAL_OUTCOME_REMOVED');
  }
  for (const [nodeKey, choiceKey] of Object.entries(progress.choices)) {
    const node = nodes.get(nodeKey);
    if (!node) {
      reasons.push(`CHOSEN_NODE_REMOVED:${nodeKey}`);
      continue;
    }
    if (!(node.choices ?? []).some((choice) => choice.key === choiceKey)) {
      reasons.push(`CHOSEN_OPTION_REMOVED:${nodeKey}:${choiceKey}`);
    }
  }
  return {
    definitionKey: progress.definitionKey,
    fromVersion: progress.definitionVersion,
    toVersion: nextDefinition.version,
    compatible: reasons.length === 0,
    reasons,
    diff: diffNarrativeDefinitions(progress.definitionSnapshot, nextDefinition),
  };
}

export function inspectHiddenMechanicalEffects(definition: NarrativeDefinition): Array<{ path: string; effect: NarrativeEffect }> {
  const unsafe = new Set<NarrativeEffect['type']>([
    'ADJUST_RELATION',
    'ADJUST_REPUTATION',
    'GRANT_RESOURCE',
    'TAKE_RESOURCE',
    'SET_QUEST_STATE',
    'SET_SERVICE_ACCESS',
    'CONTRIBUTE_REGION',
    'SET_ACCESS_POLICY',
    'APPLY_CONSEQUENCE',
    'REMOVE_CONSEQUENCE',
    'SELECT_OUTCOME',
  ]);
  return definition.nodes.flatMap((node, nodeIndex) =>
    (node.choices ?? []).flatMap((choice, choiceIndex) =>
      (choice.hiddenEffects ?? [])
        .filter((effect) => unsafe.has(effect.type))
        .map((effect) => ({ path: `nodes[${nodeIndex}].choices[${choiceIndex}].hiddenEffects`, effect })),
    ),
  );
}
