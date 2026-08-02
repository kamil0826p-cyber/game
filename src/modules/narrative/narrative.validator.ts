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
const operationPattern = /^[A-Za-z0-9:_-]{1,80}$/;

const conditionTypes = new Set<string>([
  'ALL', 'ANY', 'NOT', 'LEVEL_AT_LEAST', 'CLASS_IS', 'SPECIALIZATION_IS',
  'ITEM_OWNED', 'ITEM_USED', 'QUEST_STATUS', 'FLAG', 'NPC_RELATION',
  'FACTION_REPUTATION', 'CONSEQUENCE', 'GUILD_MEMBERSHIP', 'GUILD_ROLE',
  'PARTY_SIZE', 'REGION_VALUE', 'WORLD_CYCLE', 'ENCOUNTER_RESULT',
]);
const effectTypes = new Set<string>([
  'SET_FLAG', 'REMOVE_FLAG', 'ADJUST_RELATION', 'ADJUST_REPUTATION',
  'GRANT_RESOURCE', 'TAKE_RESOURCE', 'SET_SERVICE_ACCESS',
  'CONTRIBUTE_REGION', 'SET_ACCESS_POLICY',
  'APPLY_CONSEQUENCE', 'REMOVE_CONSEQUENCE',
]);
const terminalStates = new Set<string>([
  'SUCCESS', 'PARTIAL_SUCCESS', 'FAILURE', 'ABANDONED', 'BLOCKED',
]);
const repeatabilityPolicies = new Set<string>(['ONCE', 'REPEATABLE', 'COOLDOWN_BY_ACTIVITY']);
const objectiveEvents = new Map<string, string>([
  ['INTERACT_OBJECT', 'OBJECT_INTERACTED'],
  ['INVESTIGATE', 'CLUE_INSPECTED'],
  ['DEFEND', 'ENCOUNTER_DEFENDED'],
  ['ESCORT', 'ESCORT_COMPLETED'],
  ['USE_ITEM_AT_LOCATION', 'ITEM_USED_AT_LOCATION'],
  ['PERFORM_RITUAL', 'RITUAL_PERFORMED'],
  ['MAKE_CHOICE', 'CHOICE_MADE'],
  ['CRAFT_ITEM', 'ITEM_CRAFTED'],
  ['CONTRIBUTE_RESOURCE', 'RESOURCE_CONTRIBUTED'],
  ['COMPLETE_ENCOUNTER_WITH_CONDITION', 'ENCOUNTER_COMPLETED'],
  ['REACH_LOCATION', 'LOCATION_REACHED'],
  ['SURVIVE', 'SURVIVED'],
  ['FAIL_FORWARD', 'FAILURE_RESOLVED'],
]);

function validateConditionShapes(
  conditions: readonly NarrativeCondition[] | undefined,
  path: string,
  add: (issue: NarrativeValidationIssue) => void,
): void {
  if (!conditions) return;
  if (!Array.isArray(conditions)) {
    add({ code: 'INVALID_DEFINITION', path, message: 'Conditions must be an array.' });
    return;
  }
  for (const [index, condition] of conditions.entries()) {
    const conditionPath = `${path}[${index}]`;
    if (!isRecord(condition) || typeof condition.type !== 'string' || !conditionTypes.has(condition.type)) {
      add({ code: 'INVALID_DEFINITION', path: conditionPath, message: 'Unknown or malformed condition type.' });
      continue;
    }
    if (condition.type === 'ALL' || condition.type === 'ANY') {
      if (!Array.isArray(condition.conditions)) {
        add({ code: 'INVALID_DEFINITION', path: `${conditionPath}.conditions`, message: 'Composite conditions require a condition array.' });
      } else {
        validateConditionShapes(condition.conditions as NarrativeCondition[], `${conditionPath}.conditions`, add);
      }
    } else if (condition.type === 'NOT') {
      if (!isRecord(condition.condition)) {
        add({ code: 'INVALID_DEFINITION', path: `${conditionPath}.condition`, message: 'NOT requires one nested condition.' });
      } else {
        validateConditionShapes(
          [condition.condition as NarrativeCondition],
          `${conditionPath}.condition`,
          add,
        );
      }
    }
  }
}

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
  if (!repeatabilityPolicies.has(definition.repeatability)) {
    add({ code: 'INVALID_DEFINITION', path: 'repeatability', message: 'Unknown repeatability policy.' });
  }
  if (
    definition.repeatability === 'COOLDOWN_BY_ACTIVITY' &&
    (!definition.activityCooldownKey || !keyPattern.test(definition.activityCooldownKey))
  ) {
    add({ code: 'INVALID_DEFINITION', path: 'activityCooldownKey', message: 'Cooldown-based stories require a stable activity key.' });
  }
  if (!Array.isArray(definition.nodes) || definition.nodes.length === 0) {
    add({ code: 'INVALID_DEFINITION', path: 'nodes', message: 'A reactive story must define at least one node.' });
  }
  const exclusivePaths = new Set(definition.mutuallyExclusivePathKeys);
  if (definition.mutuallyExclusivePathKeys.length < 3 || exclusivePaths.size !== definition.mutuallyExclusivePathKeys.length) {
    add({ code: 'INVALID_DEFINITION', path: 'mutuallyExclusivePathKeys', message: 'At least three unique mutually exclusive path keys are required.' });
  }
  if (definition.outcomes.length < 3) {
    add({ code: 'INVALID_DEFINITION', path: 'outcomes', message: 'A reactive story must expose at least three terminal outcomes.' });
  }

  const nodes = new Map<string, NarrativeNodeDefinition>();
  for (const [index, node] of definition.nodes.entries()) {
    if (!keyPattern.test(node.key) || !keyPattern.test(node.chapterKey)) {
      add({ code: 'INVALID_DEFINITION', path: `nodes[${index}]`, message: 'Node and chapter keys must be stable content keys.' });
    }
    if (nodes.has(node.key)) add({ code: 'DUPLICATE_KEY', path: `nodes[${index}].key`, message: `Duplicate node key: ${node.key}` });
    nodes.set(node.key, node);
    validateConditionShapes(node.conditions, `nodes[${index}].conditions`, add);
    for (const error of impossibleConditions(node.conditions)) add({ code: 'IMPOSSIBLE_CONDITION', path: `nodes[${index}].conditions`, message: error });
    for (const [objectiveIndex, objective] of (node.objectives ?? []).entries()) {
      const objectivePath = `nodes[${index}].objectives[${objectiveIndex}]`;
      const expectedEvent = objectiveEvents.get(objective.type);
      if (!keyPattern.test(objective.key) || !expectedEvent || objective.authoritativeEventType !== expectedEvent) {
        add({ code: 'INVALID_DEFINITION', path: objectivePath, message: 'Objective type, key and authoritative event source must match.' });
      }
      if (!Number.isInteger(objective.quantity) || objective.quantity < 1) {
        add({ code: 'INVALID_DEFINITION', path: `${objectivePath}.quantity`, message: 'Objective quantity must be a positive integer.' });
      }
    }
    const choiceKeys = new Set<string>();
    for (const [choiceIndex, choice] of (node.choices ?? []).entries()) {
      if (!keyPattern.test(choice.key)) {
        add({ code: 'INVALID_DEFINITION', path: `nodes[${index}].choices[${choiceIndex}].key`, message: 'Choice key must be a stable content key.' });
      }
      if (choiceKeys.has(choice.key)) add({ code: 'DUPLICATE_KEY', path: `nodes[${index}].choices[${choiceIndex}].key`, message: `Duplicate choice key: ${choice.key}` });
      choiceKeys.add(choice.key);
      if (!Array.isArray(choice.knownEffects)) {
        add({ code: 'INVALID_DEFINITION', path: `nodes[${index}].choices[${choiceIndex}].knownEffects`, message: 'Known effects must be an array.' });
      }
      if (Boolean(choice.nextNodeKey) === Boolean(choice.outcomeKey)) add({ code: 'INVALID_DEFINITION', path: `nodes[${index}].choices[${choiceIndex}]`, message: 'A choice must define exactly one next node or terminal outcome.' });
      validateConditionShapes(choice.conditions, `nodes[${index}].choices[${choiceIndex}].conditions`, add);
      for (const error of impossibleConditions(choice.conditions)) add({ code: 'IMPOSSIBLE_CONDITION', path: `nodes[${index}].choices[${choiceIndex}].conditions`, message: error });
    }
    const directDestinations = [node.nextNodeKey, node.terminalOutcomeKey].filter(Boolean);
    if (directDestinations.length > 1) add({ code: 'INVALID_DEFINITION', path: `nodes[${index}]`, message: 'A node cannot both continue and terminate.' });
  }
  if (!nodes.has(definition.startNodeKey)) add({ code: 'MISSING_REFERENCE', path: 'startNodeKey', message: `Missing start node: ${definition.startNodeKey}` });

  const outcomes = new Map<string, NarrativeDefinition['outcomes'][number]>();
  const rewardProfiles = new Map<string, string>();
  for (const [profileKey, profile] of Object.entries(definition.rewardProfiles ?? {})) {
    if (
      !keyPattern.test(profileKey) ||
      !Number.isInteger(profile.experience) || profile.experience < 0 ||
      !Number.isInteger(profile.silver) || profile.silver < 0 ||
      profile.gold !== 0 ||
      (profile.experience === 0 && profile.silver === 0)
    ) {
      add({
        code: 'INVALID_DEFINITION',
        path: `rewardProfiles.${profileKey}`,
        message: 'Reward profiles require a stable key, non-negative experience/silver, zero premium gold and a non-zero reward.',
      });
    }
  }
  for (const [index, outcome] of definition.outcomes.entries()) {
    if (!keyPattern.test(outcome.key) || !terminalStates.has(outcome.terminalState)) {
      add({ code: 'INVALID_DEFINITION', path: `outcomes[${index}]`, message: 'Outcome key or terminal state is invalid.' });
    }
    if (outcomes.has(outcome.key)) add({ code: 'DUPLICATE_KEY', path: `outcomes[${index}].key`, message: `Duplicate outcome key: ${outcome.key}` });
    outcomes.set(outcome.key, outcome);
    if (outcome.rewardProfileKey) {
      if (!definition.rewardProfiles?.[outcome.rewardProfileKey]) {
        add({ code: 'MISSING_REFERENCE', path: `outcomes[${index}].rewardProfileKey`, message: `Missing reward profile: ${outcome.rewardProfileKey}.` });
      }
      const previous = rewardProfiles.get(outcome.rewardProfileKey);
      if (previous) add({ code: 'DOUBLE_TERMINAL_REWARD', path: `outcomes[${index}].rewardProfileKey`, message: `Reward profile ${outcome.rewardProfileKey} is assigned to both ${previous} and ${outcome.key}.` });
      rewardProfiles.set(outcome.rewardProfileKey, outcome.key);
    }
  }

  const abandoned = definition.outcomes.some((outcome) => outcome.terminalState === 'ABANDONED');
  if (abandoned && !definition.abandonmentPolicy) {
    add({ code: 'INVALID_DEFINITION', path: 'abandonmentPolicy', message: 'Stories with an abandoned outcome require an explicit recovery policy.' });
  }
  if (definition.abandonmentPolicy) {
    const policy = definition.abandonmentPolicy;
    if (
      !['DISABLED', 'FROM_START', 'FROM_CHECKPOINT'].includes(policy.restartMode) ||
      !['RETURN', 'KEEP', 'DESTROY'].includes(policy.questItemPolicy)
    ) {
      add({ code: 'INVALID_DEFINITION', path: 'abandonmentPolicy', message: 'Unknown abandonment recovery policy.' });
    }
    if (
      policy.restartMode === 'FROM_CHECKPOINT' &&
      (!policy.checkpointNodeKey || !nodes.has(policy.checkpointNodeKey))
    ) {
      add({ code: 'MISSING_REFERENCE', path: 'abandonmentPolicy.checkpointNodeKey', message: 'Checkpoint recovery requires an existing node.' });
    }
  }

  const choiceAndOutcomeKeys = new Set<string>([
    ...definition.outcomes.map((outcome) => outcome.key),
    ...definition.nodes.flatMap((node) => (node.choices ?? []).map((choice) => choice.key)),
  ]);
  for (const [index, pathKey] of definition.mutuallyExclusivePathKeys.entries()) {
    if (!keyPattern.test(pathKey) || !choiceAndOutcomeKeys.has(pathKey)) {
      add({ code: 'MISSING_REFERENCE', path: `mutuallyExclusivePathKeys[${index}]`, message: `Mutually exclusive path ${pathKey} does not reference a choice or outcome.` });
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
    const effect = entry.effect;
    if (
      !effectTypes.has(effect.type) ||
      typeof effect.reason !== 'string' ||
      effect.reason.trim().length === 0 ||
      effect.reason.length > 160
    ) {
      add({ code: 'INVALID_DEFINITION', path: entry.path, message: 'Unknown effect type or invalid audit reason.' });
    }
    if (effect.type === 'SET_FLAG' && (
      typeof effect.flagKey !== 'string' ||
      (typeof effect.value !== 'string' && typeof effect.value !== 'number' && typeof effect.value !== 'boolean') ||
      (typeof effect.value === 'number' && !Number.isFinite(effect.value))
    )) {
      add({ code: 'INVALID_DEFINITION', path: entry.path, message: 'Flag effects require a stable key and scalar value.' });
    }
    if (effect.type === 'REMOVE_FLAG' && typeof effect.flagKey !== 'string') {
      add({ code: 'INVALID_DEFINITION', path: entry.path, message: 'Flag removal requires a flag key.' });
    }
    if ((effect.type === 'ADJUST_RELATION' || effect.type === 'ADJUST_REPUTATION') && (
      !Number.isInteger(effect.delta) || effect.delta === 0 || Math.abs(effect.delta) > 1_000
    )) {
      add({ code: 'INVALID_DEFINITION', path: entry.path, message: 'Relation and reputation deltas must be bounded non-zero integers.' });
    }
    if ((effect.type === 'GRANT_RESOURCE' || effect.type === 'TAKE_RESOURCE') && (
      effect.resourceKey !== 'SILVER' || !Number.isInteger(effect.amount) || effect.amount < 1 || effect.amount > 2_147_483_647
    )) {
      add({ code: 'INVALID_DEFINITION', path: entry.path, message: 'Only positive bounded SILVER resource effects are supported.' });
    }
    if (effect.type === 'CONTRIBUTE_REGION' && (
      !Number.isInteger(effect.amount) || effect.amount < 1 || effect.amount > 2_147_483_647
    )) {
      add({ code: 'INVALID_DEFINITION', path: entry.path, message: 'Region contributions must use a positive bounded amount.' });
    }
    if ((effect.type === 'APPLY_CONSEQUENCE' || effect.type === 'REMOVE_CONSEQUENCE') && (
      effect.amount !== undefined && (!Number.isInteger(effect.amount) || effect.amount < 1 || effect.amount > 100)
    )) {
      add({ code: 'INVALID_DEFINITION', path: entry.path, message: 'Consequence amounts must be positive bounded integers.' });
    }
    if (!operationPattern.test(effect.operationKey)) add({ code: 'MISSING_OPERATION_KEY', path: `${entry.path}.operationKey`, message: 'Every effect needs a stable operation key.' });
    const previous = operationKeys.get(effect.operationKey);
    if (previous) add({ code: 'DUPLICATE_KEY', path: `${entry.path}.operationKey`, message: `Operation key ${effect.operationKey} is also used at ${previous}.` });
    operationKeys.set(effect.operationKey, entry.path);
  }

  const priorities = new Map<number, string>();
  for (const [index, root] of (definition.dialogueRoots ?? []).entries()) {
    if (!keyPattern.test(root.key) || typeof root.nodeId !== 'string' || root.nodeId.length === 0 || !Number.isFinite(root.priority)) {
      add({ code: 'INVALID_DEFINITION', path: `dialogueRoots[${index}]`, message: 'Dialogue root key, node id and priority are required.' });
    }
    validateConditionShapes(root.conditions, `dialogueRoots[${index}].conditions`, add);
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
