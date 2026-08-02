import type {
  ExpeditionDefinition,
  ExpeditionValidationContext,
  ExpeditionValidationResult,
} from './expedition.types.js';
import { EXPEDITION_TEAM_LIMIT } from './expedition.types.js';

const stableKey = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

function nodeCanReachExtraction(
  startKey: string,
  nodeByKey: ReadonlyMap<string, ExpeditionDefinition['nodes'][number]>,
): boolean {
  const queue = [startKey];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const node = nodeByKey.get(current);
    if (!node) continue;
    if (node.type === 'EXTRACTION' && (node.terminal === 'EXTRACT' || node.terminal === 'COMPLETE')) {
      return true;
    }
    queue.push(...node.outgoing.map((edge) => edge.toNodeKey));
  }
  return false;
}

export function validateExpeditionDefinition(
  definition: ExpeditionDefinition,
  context: ExpeditionValidationContext,
): ExpeditionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const prefix = `${definition.key}@${definition.version}`;
  const addError = (message: string): void => { errors.push(`${prefix}: ${message}`); };

  if (!stableKey.test(definition.key)) addError('definition key must be a stable lowercase identifier.');
  if (!Number.isInteger(definition.version) || definition.version < 1) addError('version must be a positive integer.');
  if (!definition.contentVersion.trim()) addError('contentVersion is required.');
  if (
    definition.minimumPartySize < 1 ||
    definition.maximumPartySize > EXPEDITION_TEAM_LIMIT ||
    definition.minimumPartySize > definition.maximumPartySize
  ) {
    addError(`allowed party size must remain within 1-${EXPEDITION_TEAM_LIMIT}.`);
  }
  if (
    definition.recommendedPartySize < definition.minimumPartySize ||
    definition.recommendedPartySize > definition.maximumPartySize
  ) {
    addError('recommended party size is outside the allowed range.');
  }
  if (definition.preparationCost.silver < 0 || !Number.isInteger(definition.preparationCost.silver)) {
    addError('preparation silver cost must be a non-negative integer.');
  }

  const resourceByKey = new Map(definition.resources.map((resource) => [resource.key, resource]));
  if (resourceByKey.size !== definition.resources.length) addError('resource keys must be unique.');
  for (const resource of definition.resources) {
    if (!stableKey.test(resource.key)) addError(`resource ${resource.key} has an invalid key.`);
    if (
      !Number.isInteger(resource.initial) ||
      !Number.isInteger(resource.minimum) ||
      !Number.isInteger(resource.maximum) ||
      resource.minimum > resource.maximum ||
      resource.initial < resource.minimum ||
      resource.initial > resource.maximum
    ) {
      addError(`resource ${resource.key} has invalid bounds.`);
    }
  }

  const riskByKey = new Map(definition.riskProfiles.map((profile) => [profile.key, profile]));
  if (riskByKey.size !== definition.riskProfiles.length || riskByKey.size === 0) {
    addError('risk profiles must be non-empty and unique.');
  }
  for (const profile of definition.riskProfiles) {
    if (!stableKey.test(profile.key) || !Number.isInteger(profile.version) || profile.version < 1) {
      addError(`risk profile ${profile.key} has an invalid identity.`);
    }
    if (
      profile.pendingLootLossPercent < 0 ||
      profile.pendingLootLossPercent > 100 ||
      profile.checkpointSecurityPercent < 0 ||
      profile.checkpointSecurityPercent > 100 ||
      !Number.isInteger(profile.maxConsequenceSeverity) ||
      profile.maxConsequenceSeverity < 0 ||
      !Number.isInteger(profile.insuranceCostSilver) ||
      profile.insuranceCostSilver < 0 ||
      !Number.isInteger(profile.insurancePendingLootLossReductionPercent) ||
      profile.insurancePendingLootLossReductionPercent < 0 ||
      profile.insurancePendingLootLossReductionPercent > 100 ||
      !Number.isInteger(profile.insuranceConsequenceSeverityReduction) ||
      profile.insuranceConsequenceSeverityReduction < 0 ||
      profile.insuranceConsequenceSeverityReduction > profile.maxConsequenceSeverity
    ) {
      addError(`risk profile ${profile.key} has invalid limits.`);
    }
  }

  const difficultyByKey = new Map(definition.difficultyProfiles.map((profile) => [profile.key, profile]));
  if (!difficultyByKey.has('BASE') || difficultyByKey.size !== definition.difficultyProfiles.length) {
    addError('difficulty profiles must be unique and include BASE.');
  }
  const mechanicFingerprints = new Set<string>();
  for (const profile of definition.difficultyProfiles) {
    if (profile.mechanics.length === 0) addError(`difficulty ${profile.key} must change at least one mechanic.`);
    const fingerprint = [...profile.mechanics].sort().join('|');
    if (mechanicFingerprints.has(fingerprint)) addError(`difficulty ${profile.key} duplicates another mechanics profile.`);
    mechanicFingerprints.add(fingerprint);
    for (const delta of profile.extraResourcePressure ?? []) {
      if (!resourceByKey.has(delta.resourceKey)) addError(`difficulty ${profile.key} references missing resource ${delta.resourceKey}.`);
    }
  }

  const encounterPoolByKey = new Map(definition.encounterPools.map((pool) => [pool.key, pool]));
  if (encounterPoolByKey.size !== definition.encounterPools.length) addError('encounter pool keys must be unique.');
  for (const pool of definition.encounterPools) {
    if (!stableKey.test(pool.key) || pool.entries.length === 0) addError(`encounter pool ${pool.key} is invalid or empty.`);
    for (const entry of pool.entries) {
      const encounter = context.encounters.get(entry.encounterKey);
      if (!encounter || encounter.version !== entry.encounterVersion) {
        addError(`encounter pool ${pool.key} references missing ${entry.encounterKey}@${entry.encounterVersion}.`);
      } else if (encounter.maximumActors > EXPEDITION_TEAM_LIMIT) {
        addError(`encounter ${entry.encounterKey}@${entry.encounterVersion} exceeds ${EXPEDITION_TEAM_LIMIT} actors.`);
      }
      if (!Number.isFinite(entry.weight) || entry.weight <= 0) addError(`encounter pool ${pool.key} has a non-positive weight.`);
    }
  }

  const lootPoolByKey = new Map(definition.lootPools.map((pool) => [pool.key, pool]));
  if (lootPoolByKey.size !== definition.lootPools.length) addError('loot pool keys must be unique.');
  for (const pool of definition.lootPools) {
    if (!stableKey.test(pool.key) || !Number.isInteger(pool.rolls) || pool.rolls < 1 || pool.entries.length === 0) {
      addError(`loot pool ${pool.key} is invalid or empty.`);
    }
    for (const entry of pool.entries) {
      const hasItem = typeof entry.itemKey === 'string';
      const hasSilver = typeof entry.silver === 'number';
      if (hasItem === hasSilver) addError(`loot entry ${entry.key} must define exactly one of itemKey or silver.`);
      if (entry.itemKey && !context.itemKeys.has(entry.itemKey)) addError(`loot entry ${entry.key} references missing item ${entry.itemKey}.`);
      if (entry.quantity !== undefined && (!Number.isInteger(entry.quantity) || entry.quantity < 1)) addError(`loot entry ${entry.key} has invalid quantity.`);
      if (entry.silver !== undefined && (!Number.isInteger(entry.silver) || entry.silver < 1)) addError(`loot entry ${entry.key} has invalid silver.`);
      if (!Number.isFinite(entry.weight) || entry.weight <= 0) addError(`loot entry ${entry.key} has invalid weight.`);
    }
  }
  for (const poolKey of definition.rewardRules.coreLootPoolKeys) {
    const pool = lootPoolByKey.get(poolKey);
    if (!pool) addError(`core reward references missing pool ${poolKey}.`);
    else if (!pool.entries.some((entry) => entry.core)) addError(`core reward pool ${poolKey} has no core reward.`);
  }
  if (!definition.rotationPolicy.coreRewardsRemainAvailable) addError('rotation must preserve core rewards.');
  if (definition.rotationPolicy.broadWindowDays < 7) addError('rotation window is too narrow and would create FOMO.');

  const nodeByKey = new Map(definition.nodes.map((node) => [node.key, node]));
  if (nodeByKey.size !== definition.nodes.length) addError('node keys must be unique.');
  const start = nodeByKey.get(definition.startNodeKey);
  if (!start) addError(`start node ${definition.startNodeKey} does not exist.`);
  if (start && start.outgoing.length < 2) addError('the route graph must expose at least two initial branches.');
  const extractionNodes = definition.nodes.filter((node) => node.type === 'EXTRACTION');
  if (extractionNodes.length === 0) addError('the route graph must include a legal extraction node.');

  const requiredNodeTypes = [
    'EVENT',
    'INVESTIGATION',
    'RITUAL',
    'CACHE',
    'REST',
    'HAZARD',
    'MERCHANT',
    'EXTRACTION',
    'BRANCH_GATE',
  ] as const;
  for (const requiredType of requiredNodeTypes) {
    if (!definition.nodes.some((node) => node.type === requiredType)) {
      addError(`the route graph is missing required node type ${requiredType}.`);
    }
  }
  if (!definition.nodes.some((node) => ['COMBAT', 'ELITE', 'BOSS'].includes(node.type))) {
    addError('the route graph must include at least one combat node.');
  }
  if (!definition.nodes.some((node) => node.type === 'ELITE' || node.type === 'BOSS')) {
    addError('the route graph must include at least one elite or boss node.');
  }

  for (const node of definition.nodes) {
    if (!stableKey.test(node.key)) addError(`node ${node.key} has an invalid key.`);
    if (node.type === 'EXTRACTION' && node.outgoing.length > 0) addError(`extraction node ${node.key} must be terminal.`);
    if (node.encounterPoolKey && !encounterPoolByKey.has(node.encounterPoolKey)) addError(`node ${node.key} references missing encounter pool ${node.encounterPoolKey}.`);
    if (node.lootPoolKey && !lootPoolByKey.has(node.lootPoolKey)) addError(`node ${node.key} references missing loot pool ${node.lootPoolKey}.`);
    if ((node.type === 'COMBAT' || node.type === 'ELITE' || node.type === 'BOSS') && !node.encounterPoolKey) addError(`combat node ${node.key} requires an encounter pool.`);
    if (node.type === 'RITUAL' && (!node.ritualChoices || node.ritualChoices.length < 2)) addError(`ritual node ${node.key} requires at least two disclosed choices.`);
    const edgeKeys = new Set<string>();
    for (const edge of node.outgoing) {
      if (!stableKey.test(edge.key) || edgeKeys.has(edge.key)) addError(`node ${node.key} has an invalid or duplicate edge ${edge.key}.`);
      edgeKeys.add(edge.key);
      if (!nodeByKey.has(edge.toNodeKey)) addError(`edge ${node.key}/${edge.key} references missing node ${edge.toNodeKey}.`);
      for (const cost of edge.costs ?? []) if (!resourceByKey.has(cost.resourceKey)) addError(`edge ${node.key}/${edge.key} references missing resource ${cost.resourceKey}.`);
    }
    for (const delta of [...(node.onSuccess ?? []), ...(node.onFailure ?? [])]) {
      if (!resourceByKey.has(delta.resourceKey)) addError(`node ${node.key} references missing resource ${delta.resourceKey}.`);
    }
    for (const choice of node.ritualChoices ?? []) {
      if (!stableKey.test(choice.key)) addError(`ritual choice ${node.key}/${choice.key} has an invalid key.`);
      if (!choice.disclosedEffect.trim()) addError(`ritual choice ${node.key}/${choice.key} must disclose its effect.`);
      if (choice.requiredToolItemKey && !context.itemKeys.has(choice.requiredToolItemKey)) addError(`ritual choice ${node.key}/${choice.key} references missing tool ${choice.requiredToolItemKey}.`);
      for (const delta of choice.resourceEffects ?? []) if (!resourceByKey.has(delta.resourceKey)) addError(`ritual choice ${node.key}/${choice.key} references missing resource ${delta.resourceKey}.`);
    }
  }

  if (start) {
    const reachable = new Set<string>();
    const queue = [start.key];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (reachable.has(current)) continue;
      reachable.add(current);
      const node = nodeByKey.get(current);
      if (node) queue.push(...node.outgoing.map((edge) => edge.toNodeKey));
    }
    for (const node of definition.nodes) {
      const isReachable = reachable.has(node.key);
      const reachesExtraction = nodeCanReachExtraction(node.key, nodeByKey);
      if (!isReachable) addError(`node ${node.key} is unreachable from the start.`);
      if (!reachesExtraction) addError(`node ${node.key} is trapped in a route without extraction.`);
    }
  }

  if (!definition.checkpointPolicy.reconnectAllowed) warnings.push(`${prefix}: reconnect is disabled despite expedition persistence.`);
  if (definition.checkpointPolicy.replacementAllowed) warnings.push(`${prefix}: replacement eligibility needs additional anti-duplication review.`);
  if (definition.rewardRules.distribution !== 'PERSONAL') addError('only personal expedition rewards are supported.');
  if (definition.rewardRules.fullInventoryPolicy !== 'CLAIM_QUEUE') addError('full inventory must route rewards to the claim queue.');

  return { errors, warnings };
}

export function assertExpeditionCatalog(
  definitions: readonly ExpeditionDefinition[],
  context: ExpeditionValidationContext,
): void {
  const identities = new Set<string>();
  const errors: string[] = [];
  for (const definition of definitions) {
    const identity = `${definition.key}@${definition.version}`;
    if (identities.has(identity)) errors.push(`Duplicate expedition version ${identity}.`);
    identities.add(identity);
    errors.push(...validateExpeditionDefinition(definition, context).errors);
  }
  if (errors.length > 0) throw new Error(`INVALID_EXPEDITION_CATALOG\n${errors.join('\n')}`);
}
