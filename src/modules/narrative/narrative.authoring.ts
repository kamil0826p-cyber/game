import { applyNarrativeChoice, createQuestNarrativeProgress } from './narrative.engine.js';
import type {
  NarrativeConditionContext,
  NarrativeDefinition,
  NarrativeEffect,
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
  breaking: boolean;
}

export interface NarrativePathSimulation {
  paths: Array<{ choices: string[]; outcomeKey: string; terminalState: string }>;
  truncated: boolean;
  issues: NarrativeValidationIssue[];
}

const stableJson = (value: unknown): string => JSON.stringify(value, Object.keys(value as object).sort());

export function diffNarrativeDefinitions(
  previous: NarrativeDefinition,
  next: NarrativeDefinition,
): NarrativeDefinitionDiff {
  const previousNodes = new Map(previous.nodes.map((node) => [node.key, node]));
  const nextNodes = new Map(next.nodes.map((node) => [node.key, node]));
  const previousOutcomes = new Set(previous.outcomes.map((outcome) => outcome.key));
  const nextOutcomes = new Set(next.outcomes.map((outcome) => outcome.key));
  const addedNodes = [...nextNodes.keys()].filter((key) => !previousNodes.has(key)).sort();
  const removedNodes = [...previousNodes.keys()].filter((key) => !nextNodes.has(key)).sort();
  const changedNodes = [...nextNodes.keys()]
    .filter((key) => previousNodes.has(key) && stableJson(previousNodes.get(key)) !== stableJson(nextNodes.get(key)))
    .sort();
  const addedOutcomes = [...nextOutcomes].filter((key) => !previousOutcomes.has(key)).sort();
  const removedOutcomes = [...previousOutcomes].filter((key) => !nextOutcomes.has(key)).sort();
  return {
    fromVersion: previous.version,
    toVersion: next.version,
    addedNodes,
    removedNodes,
    changedNodes,
    addedOutcomes,
    removedOutcomes,
    breaking:
      next.version <= previous.version ||
      removedNodes.length > 0 ||
      removedOutcomes.length > 0 ||
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
