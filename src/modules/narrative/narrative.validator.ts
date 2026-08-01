import type {
  NarrativeCondition,
  NarrativeDefinition,
  NarrativeEffect,
  NarrativeNodeDefinition,
} from './narrative.types.js';

export interface NarrativeValidationIssue {
  code:
    | 'INVALID_DEFINITION'
    | 'DUPLICATE_KEY'
    | 'MISSING_REFERENCE'
    | 'UNREACHABLE_NODE'
    | 'NO_TERMINAL_PATH'
    | 'DOUBLE_TERMINAL_REWARD'
    | 'MISSING_OPERATION_KEY'
    | 'IMPOSSIBLE_CONDITION'
    | 'CONFLICTING_DIALOGUE_PRIORITY';
  path: string;
  message: string;
}

export interface NarrativeValidationResult {
  valid: boolean;
  issues: NarrativeValidationIssue[];
}

const keyPattern = /^[a-z0-9][a-z0-9-]{0,95}$/;
const operationPattern = /^[A-Za-z0-9:_-]{1,128}$/;

function refs(node: NarrativeNodeDefinition): string[] {
  return [
    node.nextNodeKey,
    node.failForwardNodeKey,
    ...(node.choices ?? []).map((choice) => choice.nextNodeKey),
  ].filter((value): value is string => Boolean(value));
}

function effects(definition: NarrativeDefinition): Array<{ effect: NarrativeEffect; path: string }> {
  const entries: Array<{ effect: NarrativeEffect; path: string }> = [];
  for (const [nodeIndex, node] of definition.nodes.entries()) {
    for (const [effectIndex, effect] of (node.onCompleteEffects ?? []).entries())
      entries.push({ effect, path: `nodes[${nodeIndex}].onCompleteEffects[${effectIndex}]` });
    for (const [choiceIndex, choice] of (node.choices ?? []).entries()) {
      for (const [effectIndex, effect] of choice.knownEffects.entries())
        entries.push({ effect, path: `nodes[${nodeIndex}].choices[${choiceIndex}].knownEffects[${effectIndex}]` });
      for (const [effectIndex, effect] of (choice.hiddenEffects ?? []).entries())
        entries.push({ effect, path: `nodes[${nodeIndex}].choices[${choiceIndex}].hiddenEffects[${effectIndex}]` });
    }
  }
  for (const [outcomeIndex, outcome] of definition.outcomes.entries())
    for (const [effectIndex, effect] of outcome.effects.entries())
      entries.push({ effect, path: `outcomes[${outcomeIndex}].effects[${effectIndex}]` });
  return entries;
}

function impossibleConditions(conditions: readonly NarrativeCondition[] | undefined): string[] {
  if (!conditions) return [];
  const flattened = conditions.flatMap((condition) => condition.type === 'ALL' ? condition.conditions : [condition]);
  const flags = new Map<string, string>();
  const classes = new Set<string>();
  const errors: string[] = [];
  for (const condition of flattened) {
    if (condition.type === 'FLAG' && condition.comparison === 'EQ') {
      const encoded = JSON.stringify(condition.value);
      const previous = flags.get(condition.flagKey);
      if (previous !== undefined && previous !== encoded) errors.push(`Flag ${condition.flagKey} must equal conflicting values.`);
      flags.set(condition.flagKey, encoded);
    }
    if (condition.type === 'CLASS_IS') classes.add(condition.characterClass);
  }
  if (classes.size > 1) errors.push('A condition group requires multiple character classes at once.');
  return errors;
}

export function validateNarrativeDefinition(definition: NarrativeDefinition): NarrativeValidationResult {
  const issues: NarrativeValidationIssue[] = [];
  const add = (issue: NarrativeValidationIssue): void => { issues.push(issue); };
  if (!keyPattern.test(definition.key) || !Number.isInteger(definition.version) || definition.version < 1) {
    add({ code: 'INVALID_DEFINITION', path: 'definition', message: 'Definition key and positive integer version are required.' });
  }
  if (definition.outcomes.length < 3) {
    add({ code: 'INVALID_DEFINITION', path: 'outcomes', message: 'A reactive story must expose at least three terminal outcomes.' });
  }

  const nodes = new Map<string, NarrativeNodeDefinition>();
  for (const [index, node] of definition.nodes.entries()) {
    if (nodes.has(node.key)) add({ code: 'DUPLICATE_KEY', path: `nodes[${index}].key`, message: `Duplicate node key: ${node.key}` });
    nodes.set(node.key, node);
    for (const error of impossibleConditions(node.conditions)) add({ code: 'IMPOSSIBLE_CONDITION', path: `nodes[${index}].conditions`, message: error });
    const choiceKeys = new Set<string>();
    for (const [choiceIndex, choice] of (node.choices ?? []).entries()) {
      if (choiceKeys.has(choice.key)) add({ code: 'DUPLICATE_KEY', path: `nodes[${index}].choices[${choiceIndex}].key`, message: `Duplicate choice key: ${choice.key}` });
      choiceKeys.add(choice.key);
      if (Boolean(choice.nextNodeKey) === Boolean(choice.outcomeKey)) add({ code: 'INVALID_DEFINITION', path: `nodes[${index}].choices[${choiceIndex}]`, message: 'A choice must define exactly one next node or terminal outcome.' });
      for (const error of impossibleConditions(choice.conditions)) add({ code: 'IMPOSSIBLE_CONDITION', path: `nodes[${index}].choices[${choiceIndex}].conditions`, message: error });
    }
    const directDestinations = [node.nextNodeKey, node.terminalOutcomeKey].filter(Boolean);
    if (directDestinations.length > 1) add({ code: 'INVALID_DEFINITION', path: `nodes[${index}]`, message: 'A node cannot both continue and terminate.' });
  }
  if (!nodes.has(definition.startNodeKey)) add({ code: 'MISSING_REFERENCE', path: 'startNodeKey', message: `Missing start node: ${definition.startNodeKey}` });

  const outcomes = new Map<string, NarrativeDefinition['outcomes'][number]>();
  const rewardProfiles = new Map<string, string>();
  for (const [index, outcome] of definition.outcomes.entries()) {
    if (outcomes.has(outcome.key)) add({ code: 'DUPLICATE_KEY', path: `outcomes[${index}].key`, message: `Duplicate outcome key: ${outcome.key}` });
    outcomes.set(outcome.key, outcome);
    if (outcome.rewardProfileKey) {
      const previous = rewardProfiles.get(outcome.rewardProfileKey);
      if (previous) add({ code: 'DOUBLE_TERMINAL_REWARD', path: `outcomes[${index}].rewardProfileKey`, message: `Reward profile ${outcome.rewardProfileKey} is assigned to both ${previous} and ${outcome.key}.` });
      rewardProfiles.set(outcome.rewardProfileKey, outcome.key);
    }
  }

  for (const [index, node] of definition.nodes.entries()) {
    for (const reference of refs(node)) if (!nodes.has(reference)) add({ code: 'MISSING_REFERENCE', path: `nodes[${index}]`, message: `Missing node reference: ${reference}` });
    for (const outcomeKey of [node.terminalOutcomeKey, ...(node.choices ?? []).map((choice) => choice.outcomeKey)].filter(Boolean) as string[])
      if (!outcomes.has(outcomeKey)) add({ code: 'MISSING_REFERENCE', path: `nodes[${index}]`, message: `Missing outcome reference: ${outcomeKey}` });
  }

  const reachable = new Set<string>();
  const queue = nodes.has(definition.startNodeKey) ? [definition.startNodeKey] : [];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const key = queue[cursor]!;
    if (reachable.has(key)) continue;
    reachable.add(key);
    for (const target of refs(nodes.get(key)!)) if (!reachable.has(target)) queue.push(target);
  }
  for (const [index, node] of definition.nodes.entries()) if (!reachable.has(node.key)) add({ code: 'UNREACHABLE_NODE', path: `nodes[${index}]`, message: `Node ${node.key} is unreachable from ${definition.startNodeKey}.` });

  const canTerminate = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of definition.nodes) {
      if (canTerminate.has(node.key)) continue;
      const directTerminal = Boolean(node.terminalOutcomeKey || (node.choices ?? []).some((choice) => choice.outcomeKey));
      const terminalViaNext = refs(node).some((target) => canTerminate.has(target));
      if (directTerminal || terminalViaNext) {
        canTerminate.add(node.key);
        changed = true;
      }
    }
  }
  for (const [index, node] of definition.nodes.entries()) if (reachable.has(node.key) && !canTerminate.has(node.key)) add({ code: 'NO_TERMINAL_PATH', path: `nodes[${index}]`, message: `Node ${node.key} is in a cycle or branch with no terminal outcome.` });

  for (const [nodeIndex, node] of definition.nodes.entries()) {
    for (const [choiceIndex, choice] of (node.choices ?? []).entries()) {
      for (const effect of choice.hiddenEffects ?? []) {
        if ([
          'ADJUST_RELATION', 'ADJUST_REPUTATION', 'GRANT_RESOURCE', 'TAKE_RESOURCE',
          'SET_QUEST_STATE', 'SET_SERVICE_ACCESS', 'CONTRIBUTE_REGION', 'SET_ACCESS_POLICY',
          'APPLY_CONSEQUENCE', 'REMOVE_CONSEQUENCE', 'SELECT_OUTCOME',
        ].includes(effect.type)) {
          add({
            code: 'INVALID_DEFINITION',
            path: `nodes[${nodeIndex}].choices[${choiceIndex}].hiddenEffects`,
            message: `Mechanical or permanent effect ${effect.type} must be disclosed in knownEffects.`,
          });
        }
      }
    }
  }

  const operationKeys = new Map<string, string>();
  for (const entry of effects(definition)) {
    if (!operationPattern.test(entry.effect.operationKey)) add({ code: 'MISSING_OPERATION_KEY', path: `${entry.path}.operationKey`, message: 'Every effect needs a stable operation key.' });
    const previous = operationKeys.get(entry.effect.operationKey);
    if (previous) add({ code: 'DUPLICATE_KEY', path: `${entry.path}.operationKey`, message: `Operation key ${entry.effect.operationKey} is also used at ${previous}.` });
    operationKeys.set(entry.effect.operationKey, entry.path);
  }

  const priorities = new Map<number, string>();
  for (const [index, root] of (definition.dialogueRoots ?? []).entries()) {
    if (root.conditions.length > 0) continue;
    const previous = priorities.get(root.priority);
    if (previous) add({ code: 'CONFLICTING_DIALOGUE_PRIORITY', path: `dialogueRoots[${index}].priority`, message: `Unconditional roots ${previous} and ${root.key} have the same priority.` });
    priorities.set(root.priority, root.key);
  }
  return { valid: issues.length === 0, issues };
}

export function requireValidNarrativeDefinition(value: NarrativeDefinition): NarrativeDefinition {
  const result = validateNarrativeDefinition(value);
  if (!result.valid) throw new Error(result.issues.map((issue) => `${issue.code} ${issue.path}: ${issue.message}`).join('\n'));
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseNarrativeDefinition(value: unknown): NarrativeDefinition | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.key !== 'string' ||
    !Number.isInteger(value.version) ||
    typeof value.startNodeKey !== 'string' ||
    typeof value.repeatability !== 'string' ||
    !Array.isArray(value.mutuallyExclusivePathKeys) ||
    !Array.isArray(value.nodes) ||
    !Array.isArray(value.outcomes)
  ) return undefined;
  try {
    const candidate = structuredClone(value) as unknown as NarrativeDefinition;
    return validateNarrativeDefinition(candidate).valid ? candidate : undefined;
  } catch {
    return undefined;
  }
}
