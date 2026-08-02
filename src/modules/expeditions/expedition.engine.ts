import { deterministicPick, deterministicUnit } from './expedition.random.js';
import type {
  ExpeditionDefinition,
  ExpeditionLootStack,
  ExpeditionNodeDefinition,
  ExpeditionNodeResolution,
  ExpeditionOperationResult,
  ExpeditionPreparationSnapshot,
  ExpeditionResourceDelta,
  ExpeditionRiskProfile,
  ExpeditionRunSnapshot,
  ExpeditionRouteEdge,
} from './expedition.types.js';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function resourceMap(definition: ExpeditionDefinition): Record<string, number> {
  return Object.fromEntries(definition.resources.map((resource) => [resource.key, resource.initial]));
}

function applyResourceDeltas(
  run: ExpeditionRunSnapshot,
  deltas: readonly ExpeditionResourceDelta[],
): void {
  const resourceByKey = new Map(run.definitionSnapshot.resources.map((resource) => [resource.key, resource]));
  for (const delta of deltas) {
    const definition = resourceByKey.get(delta.resourceKey);
    if (!definition) throw new Error(`EXPEDITION_RESOURCE_UNKNOWN:${delta.resourceKey}`);
    const current = run.resources[delta.resourceKey] ?? definition.initial;
    run.resources[delta.resourceKey] = Math.max(
      definition.minimum,
      Math.min(definition.maximum, current + Math.trunc(delta.amount)),
    );
  }
}

function resourceFailure(run: ExpeditionRunSnapshot): boolean {
  return run.definitionSnapshot.resources.some(
    (definition) =>
      definition.failureAtMinimum &&
      (run.resources[definition.key] ?? definition.initial) <= definition.minimum,
  );
}

function eligibleEncounterEntries(
  node: ExpeditionNodeDefinition,
  run: ExpeditionRunSnapshot,
) {
  if (!node.encounterPoolKey) return [];
  const pool = run.definitionSnapshot.encounterPools.find((candidate) => candidate.key === node.encounterPoolKey);
  if (!pool) throw new Error(`EXPEDITION_ENCOUNTER_POOL_UNKNOWN:${node.encounterPoolKey}`);
  const ritualSelections = new Set(Object.values(run.preparation.ritualChoices));
  const eligible = pool.entries.filter(
    (entry) => !entry.requiredRitualChoiceKey || ritualSelections.has(entry.requiredRitualChoiceKey),
  );
  return eligible.length > 0 ? eligible : pool.entries.filter((entry) => !entry.requiredRitualChoiceKey);
}

function resolveEncounter(node: ExpeditionNodeDefinition, run: ExpeditionRunSnapshot) {
  const entries = eligibleEncounterEntries(node, run);
  const selected = deterministicPick(entries, run.seed, 'encounter', node.key, run.decisions.length);
  if (!selected) return undefined;
  return {
    encounterKey: selected.encounterKey,
    encounterVersion: selected.encounterVersion,
    ...(selected.variantKey ? { variantKey: selected.variantKey } : {}),
  };
}

function resolveLoot(node: ExpeditionNodeDefinition, run: ExpeditionRunSnapshot): ExpeditionLootStack[] {
  if (!node.lootPoolKey) return [];
  const pool = run.definitionSnapshot.lootPools.find((candidate) => candidate.key === node.lootPoolKey);
  if (!pool) throw new Error(`EXPEDITION_LOOT_POOL_UNKNOWN:${node.lootPoolKey}`);
  const resolved: ExpeditionLootStack[] = [];
  for (let roll = 0; roll < pool.rolls; roll += 1) {
    const selected = deterministicPick(pool.entries, run.seed, 'loot', node.key, run.decisions.length, roll);
    if (!selected) continue;
    resolved.push({
      sourceKey: `${node.key}:${selected.key}:${roll}`,
      category: selected.category,
      core: selected.core,
      ...(selected.itemKey ? { itemKey: selected.itemKey, quantity: selected.quantity ?? 1 } : {}),
      ...(selected.silver ? { silver: selected.silver } : {}),
    });
  }
  return resolved;
}

function deterministicPortion(
  total: number,
  ratio: number,
  seed: number,
  ...parts: Array<string | number>
): number {
  const exact = Math.max(0, total) * Math.max(0, Math.min(1, ratio));
  const whole = Math.floor(exact);
  const fractional = exact - whole;
  return Math.min(total, whole + (deterministicUnit(seed, ...parts) < fractional ? 1 : 0));
}

function secureCheckpointLoot(run: ExpeditionRunSnapshot): ExpeditionLootStack[] {
  if (!run.definitionSnapshot.checkpointPolicy.secureOnCheckpoint || run.pendingLoot.length === 0) return [];
  const ratio = run.riskSnapshot.checkpointSecurityPercent / 100;
  const secured: ExpeditionLootStack[] = [];
  const remaining: ExpeditionLootStack[] = [];
  for (const stack of run.pendingLoot) {
    if (stack.silver) {
      const amount = Math.floor(stack.silver * ratio);
      if (amount > 0) secured.push({ ...stack, silver: amount, sourceKey: `${stack.sourceKey}:secured` });
      if (stack.silver - amount > 0) remaining.push({ ...stack, silver: stack.silver - amount });
      continue;
    }
    const quantity = stack.quantity ?? 1;
    const amount = deterministicPortion(
      quantity,
      ratio,
      run.seed,
      'checkpoint',
      run.revision,
      stack.sourceKey,
    );
    if (amount > 0) secured.push({ ...stack, quantity: amount, sourceKey: `${stack.sourceKey}:secured` });
    if (quantity - amount > 0) remaining.push({ ...stack, quantity: quantity - amount });
  }
  run.pendingLoot = remaining;
  run.securedLoot.push(...secured);
  return secured;
}

export function createExpeditionRun(input: {
  runId: string;
  definition: ExpeditionDefinition;
  seed: number;
  preparation: ExpeditionPreparationSnapshot;
  epochDay?: number;
  now?: string;
}): ExpeditionRunSnapshot {
  const definitionSnapshot = copy(input.definition);
  const riskSnapshot = definitionSnapshot.riskProfiles.find(
    (profile) =>
      profile.key === input.preparation.selectedRiskProfileKey &&
      profile.version === input.preparation.acceptedRiskVersion,
  );
  if (!riskSnapshot) throw new Error('EXPEDITION_RISK_PROFILE_UNKNOWN');
  if (
    input.preparation.members.length < definitionSnapshot.minimumPartySize ||
    input.preparation.members.length > definitionSnapshot.maximumPartySize
  ) {
    throw new Error('EXPEDITION_PARTY_SIZE_INVALID');
  }
  const resources = resourceMap(definitionSnapshot);
  const difficulty = definitionSnapshot.difficultyProfiles.find(
    (profile) => profile.key === input.preparation.selectedDifficulty,
  );
  if (!difficulty) throw new Error('EXPEDITION_DIFFICULTY_UNKNOWN');
  const rotation = resolveRotationVariant(definitionSnapshot, input.epochDay ?? 0);
  const run: ExpeditionRunSnapshot = {
    runId: input.runId,
    definitionKey: definitionSnapshot.key,
    definitionVersion: definitionSnapshot.version,
    contentVersion: definitionSnapshot.contentVersion,
    definitionSnapshot,
    seed: input.seed >>> 0,
    rotationVariantKey: rotation.variantKey,
    createdAt: input.now ?? new Date().toISOString(),
    status: 'PREPARING',
    preparation: copy(input.preparation),
    riskSnapshot: copy(riskSnapshot),
    currentNodeKey: definitionSnapshot.startNodeKey,
    visitedNodeKeys: [definitionSnapshot.startNodeKey],
    resources,
    activeModifiers: [
      ...definitionSnapshot.globalMutators,
      ...difficulty.mechanics,
      `ROTATION:${rotation.variantKey}`,
    ],
    pendingLoot: [],
    securedLoot: [],
    consequences: [],
    decisions: [],
    contributions: [],
    nodeResolutions: {},
    processedOperations: {},
    revision: 0,
  };
  applyResourceDeltas(run, difficulty.extraResourcePressure ?? []);
  return run;
}

export function startExpedition(
  run: ExpeditionRunSnapshot,
  now = new Date().toISOString(),
): ExpeditionRunSnapshot {
  if (run.status !== 'PREPARING') throw new Error('EXPEDITION_NOT_PREPARING');
  return {
    ...copy(run),
    status: 'ACTIVE',
    startedAt: now,
    revision: run.revision + 1,
  };
}

export function availableRoutes(
  run: ExpeditionRunSnapshot,
  conditionEvaluator: (conditions: NonNullable<ExpeditionRouteEdge['conditions']>) => boolean = () => true,
): ExpeditionRouteEdge[] {
  const node = run.definitionSnapshot.nodes.find((candidate) => candidate.key === run.currentNodeKey);
  if (!node) throw new Error('EXPEDITION_NODE_UNKNOWN');
  return node.outgoing.filter((edge) => !edge.conditions?.length || conditionEvaluator(edge.conditions));
}

export function advanceExpedition(
  source: ExpeditionRunSnapshot,
  input: {
    operationId: string;
    edgeKey: string;
    expectedRevision: number;
    conditionEvaluator?: (conditions: NonNullable<ExpeditionRouteEdge['conditions']>) => boolean;
  },
): { run: ExpeditionRunSnapshot; result: ExpeditionOperationResult } {
  const replay = source.processedOperations[input.operationId];
  if (replay) return { run: source, result: replay };
  if (source.status !== 'ACTIVE') throw new Error('EXPEDITION_NOT_ACTIVE');
  if (source.revision !== input.expectedRevision) throw new Error('EXPEDITION_REVISION_CONFLICT');
  const run = copy(source);
  const fromNode = run.definitionSnapshot.nodes.find((candidate) => candidate.key === run.currentNodeKey);
  if (!fromNode) throw new Error('EXPEDITION_NODE_UNKNOWN');
  if (!run.nodeResolutions[fromNode.key] && fromNode.type !== 'START' && fromNode.type !== 'CACHE' && fromNode.type !== 'BRANCH_GATE' && fromNode.type !== 'RITUAL') {
    throw new Error('EXPEDITION_NODE_UNRESOLVED');
  }
  if (fromNode.type === 'RITUAL' && !run.preparation.ritualChoices[fromNode.key]) {
    throw new Error('EXPEDITION_RITUAL_CHOICE_REQUIRED');
  }
  const route = availableRoutes(run, input.conditionEvaluator).find((edge) => edge.key === input.edgeKey);
  if (!route) throw new Error('EXPEDITION_ROUTE_UNAVAILABLE');
  applyResourceDeltas(run, route.costs ?? []);
  if (resourceFailure(run)) run.status = 'FAILED';
  run.decisions.push({
    sequence: run.decisions.length + 1,
    edgeKey: route.key,
    fromNodeKey: fromNode.key,
    toNodeKey: route.toNodeKey,
    operationId: input.operationId,
  });
  run.currentNodeKey = route.toNodeKey;
  if (!run.visitedNodeKeys.includes(route.toNodeKey)) run.visitedNodeKeys.push(route.toNodeKey);
  run.revision += 1;
  const target = run.definitionSnapshot.nodes.find((candidate) => candidate.key === route.toNodeKey)!;
  const encounter = resolveEncounter(target, run);
  if (encounter) run.pendingEncounter = { nodeKey: target.key, ...encounter };
  else delete run.pendingEncounter;
  const result: ExpeditionOperationResult = {
    operationId: input.operationId,
    kind: 'ADVANCE',
    revision: run.revision,
    status: run.status,
    nodeKey: run.currentNodeKey,
    ...(encounter ? { encounter } : {}),
  };
  run.processedOperations[input.operationId] = result;
  return { run, result };
}

export function chooseRitual(
  source: ExpeditionRunSnapshot,
  input: { operationId: string; choiceKey: string; expectedRevision: number },
): { run: ExpeditionRunSnapshot; result: ExpeditionOperationResult } {
  const replay = source.processedOperations[input.operationId];
  if (replay) return { run: source, result: replay };
  if (source.status !== 'ACTIVE' || source.revision !== input.expectedRevision) {
    throw new Error(source.status !== 'ACTIVE' ? 'EXPEDITION_NOT_ACTIVE' : 'EXPEDITION_REVISION_CONFLICT');
  }
  const run = copy(source);
  const node = run.definitionSnapshot.nodes.find((candidate) => candidate.key === run.currentNodeKey);
  if (!node || node.type !== 'RITUAL') throw new Error('EXPEDITION_NOT_RITUAL_NODE');
  const choice = node.ritualChoices?.find((candidate) => candidate.key === input.choiceKey);
  if (!choice) throw new Error('EXPEDITION_RITUAL_CHOICE_UNKNOWN');
  if (run.preparation.ritualChoices[node.key]) {
    throw new Error('EXPEDITION_RITUAL_ALREADY_CHOSEN');
  }
  run.preparation.ritualChoices[node.key] = choice.key;
  applyResourceDeltas(run, choice.resourceEffects ?? []);
  if (choice.corruptionDelta) {
    run.consequences.push({ key: 'ritual-corruption', severity: choice.corruptionDelta, sourceNodeKey: node.key });
  }
  run.revision += 1;
  const result: ExpeditionOperationResult = {
    operationId: input.operationId,
    kind: 'RESOLVE_NODE',
    revision: run.revision,
    status: run.status,
    nodeKey: node.key,
  };
  run.processedOperations[input.operationId] = result;
  return { run, result };
}

export function resolveCurrentNode(
  source: ExpeditionRunSnapshot,
  input: {
    operationId: string;
    expectedRevision: number;
    outcome: 'SUCCESS' | 'VICTORY' | 'FAILURE';
  },
): { run: ExpeditionRunSnapshot; result: ExpeditionOperationResult } {
  const replay = source.processedOperations[input.operationId];
  if (replay) return { run: source, result: replay };
  if (source.status !== 'ACTIVE') throw new Error('EXPEDITION_NOT_ACTIVE');
  if (source.revision !== input.expectedRevision) throw new Error('EXPEDITION_REVISION_CONFLICT');
  const run = copy(source);
  const node = run.definitionSnapshot.nodes.find((candidate) => candidate.key === run.currentNodeKey);
  if (!node) throw new Error('EXPEDITION_NODE_UNKNOWN');
  if (run.nodeResolutions[node.key]) throw new Error('EXPEDITION_NODE_ALREADY_RESOLVED');
  const success = input.outcome !== 'FAILURE';
  applyResourceDeltas(run, success ? node.onSuccess ?? [] : node.onFailure ?? []);
  const loot = success ? resolveLoot(node, run) : [];
  run.pendingLoot.push(...loot);
  const encounter = resolveEncounter(node, run);
  const resolution: ExpeditionNodeResolution = {
    nodeKey: node.key,
    ...(encounter ? { encounter } : {}),
    ...(loot.length > 0 ? { loot } : {}),
    ...(node.type === 'RITUAL' ? { ritualChoiceKey: run.preparation.ritualChoices[node.key] } : {}),
    resolvedAtRevision: run.revision + 1,
  };
  run.nodeResolutions[node.key] = resolution;
  delete run.pendingEncounter;
  const secured = node.checkpoint ? secureCheckpointLoot(run) : [];
  if (!success || resourceFailure(run)) run.status = 'FAILED';
  run.revision += 1;
  const result: ExpeditionOperationResult = {
    operationId: input.operationId,
    kind: 'RESOLVE_NODE',
    revision: run.revision,
    status: run.status,
    nodeKey: node.key,
    ...(loot.length > 0 ? { lootAdded: loot } : {}),
    ...(secured.length > 0 ? { lootSecured: secured } : {}),
    ...(encounter ? { encounter } : {}),
  };
  run.processedOperations[input.operationId] = result;
  return { run, result };
}

export function checkpointCurrentNode(
  source: ExpeditionRunSnapshot,
  input: { operationId: string; expectedRevision: number },
): { run: ExpeditionRunSnapshot; result: ExpeditionOperationResult } {
  const replay = source.processedOperations[input.operationId];
  if (replay) return { run: source, result: replay };
  if (source.status !== 'ACTIVE' || source.revision !== input.expectedRevision) {
    throw new Error(source.status !== 'ACTIVE' ? 'EXPEDITION_NOT_ACTIVE' : 'EXPEDITION_REVISION_CONFLICT');
  }
  const run = copy(source);
  const node = run.definitionSnapshot.nodes.find((candidate) => candidate.key === run.currentNodeKey);
  if (!node?.checkpoint) throw new Error('EXPEDITION_NOT_CHECKPOINT');
  const secured = secureCheckpointLoot(run);
  run.nodeResolutions[node.key] = { nodeKey: node.key, resolvedAtRevision: run.revision + 1 };
  run.revision += 1;
  const result: ExpeditionOperationResult = {
    operationId: input.operationId,
    kind: 'RESOLVE_NODE',
    revision: run.revision,
    status: run.status,
    nodeKey: node.key,
    ...(secured.length > 0 ? { lootSecured: secured } : {}),
  };
  run.processedOperations[input.operationId] = result;
  return { run, result };
}

export function terminalLoot(run: ExpeditionRunSnapshot): ExpeditionLootStack[] {
  return [...run.securedLoot, ...run.pendingLoot].map((stack) => ({ ...stack }));
}

export function markExtracted(
  source: ExpeditionRunSnapshot,
  input: { operationId: string; expectedRevision: number; now?: string },
): { run: ExpeditionRunSnapshot; result: ExpeditionOperationResult } {
  const replay = source.processedOperations[input.operationId];
  if (replay) return { run: source, result: replay };
  if (source.status !== 'ACTIVE' || source.revision !== input.expectedRevision) {
    throw new Error(source.status !== 'ACTIVE' ? 'EXPEDITION_NOT_ACTIVE' : 'EXPEDITION_REVISION_CONFLICT');
  }
  const node = source.definitionSnapshot.nodes.find((candidate) => candidate.key === source.currentNodeKey);
  if (!node || node.type !== 'EXTRACTION') throw new Error('EXPEDITION_NOT_AT_EXTRACTION');
  const run = copy(source);
  run.status = node.terminal === 'COMPLETE' ? 'COMPLETED' : 'EXTRACTED';
  run.terminalAt = input.now ?? new Date().toISOString();
  run.revision += 1;
  const result: ExpeditionOperationResult = {
    operationId: input.operationId,
    kind: 'EXTRACT',
    revision: run.revision,
    status: run.status,
    nodeKey: node.key,
  };
  run.processedOperations[input.operationId] = result;
  return { run, result };
}

function retainPendingLootByRisk(run: ExpeditionRunSnapshot): void {
  const insuranceReduction = run.preparation.insurancePurchased
    ? run.riskSnapshot.insurancePendingLootLossReductionPercent
    : 0;
  const effectiveLossPercent = Math.max(
    0,
    run.riskSnapshot.pendingLootLossPercent - insuranceReduction,
  );
  const retainedRatio = (100 - effectiveLossPercent) / 100;
  run.pendingLoot = run.pendingLoot.flatMap<ExpeditionLootStack>((stack) => {
    if (stack.silver) {
      const silver = Math.floor(stack.silver * retainedRatio);
      return silver > 0 ? [{ ...stack, silver }] : [];
    }
    const quantity = deterministicPortion(
      stack.quantity ?? 1,
      retainedRatio,
      run.seed,
      'failure-retention',
      run.revision,
      stack.sourceKey,
    );
    return quantity > 0 ? [{ ...stack, quantity }] : [];
  });
}

export function failExpedition(
  source: ExpeditionRunSnapshot,
  input: { operationId: string; expectedRevision: number; sourceNodeKey: string; now?: string },
): { run: ExpeditionRunSnapshot; result: ExpeditionOperationResult } {
  const replay = source.processedOperations[input.operationId];
  if (replay) return { run: source, result: replay };
  if ((source.status !== 'ACTIVE' && source.status !== 'FAILED') || source.revision !== input.expectedRevision) {
    throw new Error(source.status !== 'ACTIVE' && source.status !== 'FAILED' ? 'EXPEDITION_NOT_ACTIVE' : 'EXPEDITION_REVISION_CONFLICT');
  }
  const run = copy(source);
  retainPendingLootByRisk(run);
  const pool = run.riskSnapshot.consequencePool;
  const severity = Math.max(
    0,
    run.riskSnapshot.maxConsequenceSeverity -
      (run.preparation.insurancePurchased
        ? run.riskSnapshot.insuranceConsequenceSeverityReduction
        : 0),
  );
  if (pool.length > 0 && severity > 0) {
    const index = Math.floor(run.seed % pool.length);
    run.consequences.push({
      key: pool[index]!,
      severity,
      sourceNodeKey: input.sourceNodeKey,
    });
  }
  run.status = 'FAILED';
  run.terminalAt = input.now ?? new Date().toISOString();
  delete run.pendingEncounter;
  run.revision += 1;
  const result: ExpeditionOperationResult = {
    operationId: input.operationId,
    kind: 'RESOLVE_NODE',
    revision: run.revision,
    status: run.status,
    nodeKey: run.currentNodeKey,
  };
  run.processedOperations[input.operationId] = result;
  return { run, result };
}

export function abandonExpedition(
  source: ExpeditionRunSnapshot,
  input: { operationId: string; expectedRevision: number; now?: string },
): { run: ExpeditionRunSnapshot; result: ExpeditionOperationResult } {
  const replay = source.processedOperations[input.operationId];
  if (replay) return { run: source, result: replay };
  if ((source.status !== 'ACTIVE' && source.status !== 'PREPARING') || source.revision !== input.expectedRevision) {
    throw new Error(source.status !== 'ACTIVE' && source.status !== 'PREPARING' ? 'EXPEDITION_TERMINAL' : 'EXPEDITION_REVISION_CONFLICT');
  }
  const run = copy(source);
  retainPendingLootByRisk(run);
  run.status = 'ABANDONED';
  run.terminalAt = input.now ?? new Date().toISOString();
  delete run.pendingEncounter;
  run.revision += 1;
  const result: ExpeditionOperationResult = {
    operationId: input.operationId,
    kind: 'ABANDON',
    revision: run.revision,
    status: run.status,
    nodeKey: run.currentNodeKey,
  };
  run.processedOperations[input.operationId] = result;
  return { run, result };
}

export function resolveRotationVariant(
  definition: ExpeditionDefinition,
  epochDay: number,
): { variantKey: string; coreRewardsRemainAvailable: true } {
  const values = definition.rotationPolicy.rotationVariantKeys;
  if (values.length === 0) throw new Error('EXPEDITION_ROTATION_EMPTY');
  const period = definition.rotationPolicy.cadence === 'WEEKLY' ? 7 : Math.max(28, definition.rotationPolicy.broadWindowDays);
  const index = Math.floor(Math.max(0, epochDay) / period) % values.length;
  return { variantKey: values[index]!, coreRewardsRemainAvailable: true };
}
