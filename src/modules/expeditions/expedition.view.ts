import type { NarrativeCondition } from '../narrative/narrative.types.js';
import { availableRoutes } from './expedition.engine.js';
import type {
  ExpeditionDefinition,
  ExpeditionLootStack,
  ExpeditionRouteEdge,
  ExpeditionRunSnapshot,
} from './expedition.types.js';

export interface ExpeditionCatalogView {
  key: string;
  version: number;
  contentVersion: string;
  name: string;
  minimumPartySize: number;
  maximumPartySize: number;
  recommendedPartySize: number;
  minimumCharacterLevel: number;
  preparationCost: ExpeditionDefinition['preparationCost'];
  riskProfiles: ExpeditionDefinition['riskProfiles'];
  difficultyProfiles: ExpeditionDefinition['difficultyProfiles'];
  rotationPolicy: ExpeditionDefinition['rotationPolicy'];
}

export interface ExpeditionRouteView {
  key: string;
  toNodeKey: string;
  threatType: string;
  knownCost?: string;
  rewardCategory?: string;
  scoutHint?: string;
}

export interface ExpeditionFinalReport {
  outcome: ExpeditionRunSnapshot['status'];
  completionNodeKey: string;
  failureNodeKey?: string;
  groupSize: number;
  startedAt?: string;
  terminalAt?: string;
  durationMs?: number;
  visitedNodeKeys: string[];
  decisions: ExpeditionRunSnapshot['decisions'];
  economy: {
    securedSilver: number;
    pendingSilver: number;
    securedItemQuantity: number;
    pendingItemQuantity: number;
  };
  contributions: Array<{
    characterId: string;
    name: string;
    roleKey: string;
    encounters: number;
    eligibleEncounters: number;
    score: number;
    actions: number;
    timedOutTurns: number;
    damage: number;
    healing: number;
    protection: number;
    interrupts: number;
    cleanses: number;
    mechanics: number;
  }>;
  consequences: ExpeditionRunSnapshot['consequences'];
}

export interface ExpeditionPublicView {
  runId: string;
  definition: {
    key: string;
    version: number;
    contentVersion: string;
    name: string;
    rotationVariantKey: string;
  };
  status: ExpeditionRunSnapshot['status'];
  revision: number;
  party: ExpeditionRunSnapshot['preparation']['members'];
  preparation: Omit<ExpeditionRunSnapshot['preparation'], 'members'>;
  acceptedRisk: ExpeditionRunSnapshot['riskSnapshot'];
  currentNode: {
    key: string;
    type: string;
    title: string;
    description: string;
    checkpoint: boolean;
    terminal?: string;
  };
  availableRoutes: ExpeditionRouteView[];
  ritualChoices: Array<{ key: string; label: string; disclosedEffect: string }>;
  resources: Array<{ key: string; label: string; value: number; minimum: number; maximum: number }>;
  activeModifiers: string[];
  pendingLoot: ExpeditionLootStack[];
  securedLoot: ExpeditionLootStack[];
  consequences: ExpeditionRunSnapshot['consequences'];
  pendingEncounter?: ExpeditionRunSnapshot['pendingEncounter'];
  visitedNodeKeys: string[];
  canExtract: boolean;
  reconnectable: boolean;
  finalReport?: ExpeditionFinalReport;
}

const MODIFIER_LABELS: Readonly<Record<string, string>> = {
  NO_PERMANENT_GEAR_LOSS: 'Brak trwałej utraty wyposażenia',
  FROZEN_PARTY_AFTER_START: 'Skład drużyny zablokowany po rozpoczęciu',
  CHECKPOINTED_STATE: 'Stan zapisywany w punktach kontrolnych',
  SCOUTED_BRANCHES: 'Rozpoznane odnogi trasy',
  ONE_RITUAL_COUNTER: 'Jedna rytualna kontra',
  PARTIAL_ROUTE_INTEL: 'Częściowe informacje o trasie',
  STARTING_THREAT: 'Podwyższone zagrożenie początkowe',
  NEMESIS_VARIANT: 'Wariant nemezis',
  RITUAL_STABILITY_DRAIN: 'Spadek stabilności rytuału',
  EXTRA_STARTING_THREAT: 'Dodatkowe zagrożenie początkowe',
};

const ROTATION_LABELS: Readonly<Record<string, string>> = {
  'ashen-wind': 'Popielny Wiatr',
  'silent-bells': 'Milczące Dzwony',
  'broken-moon': 'Pęknięty Księżyc',
};

const CONSEQUENCE_LABELS: Readonly<Record<string, string>> = {
  'ash-burn': 'Popielne oparzenie',
  'frayed-nerves': 'Nadszarpnięte nerwy',
  'ritual-scar': 'Blizna rytualna',
};

function modifierLabel(modifier: string): string {
  if (modifier.startsWith('ROTATION:')) {
    const key = modifier.slice('ROTATION:'.length);
    return `Rotacja: ${ROTATION_LABELS[key] ?? key}`;
  }
  return MODIFIER_LABELS[modifier] ?? modifier;
}

function consequenceLabel(key: string): string {
  return CONSEQUENCE_LABELS[key] ?? key;
}

function localizedConsequences(
  consequences: ExpeditionRunSnapshot['consequences'],
): ExpeditionRunSnapshot['consequences'] {
  return consequences.map((consequence) => ({
    ...consequence,
    key: consequenceLabel(consequence.key),
  }));
}

function sumSilver(stacks: readonly ExpeditionLootStack[]): number {
  return stacks.reduce((sum, stack) => sum + (stack.silver ?? 0), 0);
}

function sumItems(stacks: readonly ExpeditionLootStack[]): number {
  return stacks.reduce((sum, stack) => sum + (stack.itemKey ? stack.quantity ?? 1 : 0), 0);
}

function requiredMinimumCharacterLevel(condition: NarrativeCondition): number {
  if (condition.type === 'LEVEL_AT_LEAST') return condition.level;
  if (condition.type === 'ALL') {
    return condition.conditions.reduce(
      (minimum, child) => Math.max(minimum, requiredMinimumCharacterLevel(child)),
      1,
    );
  }
  return 1;
}

function minimumCharacterLevel(definition: ExpeditionDefinition): number {
  return definition.entryConditions.reduce(
    (minimum, condition) => Math.max(minimum, requiredMinimumCharacterLevel(condition)),
    1,
  );
}

function finalReport(run: ExpeditionRunSnapshot): ExpeditionFinalReport | undefined {
  if (!['EXTRACTED', 'FAILED', 'ABANDONED', 'COMPLETED'].includes(run.status)) return undefined;
  const contributionByCharacter = new Map(
    run.preparation.members.map((member) => [member.characterId, {
      characterId: member.characterId,
      name: member.name,
      roleKey: member.roleKey,
      encounters: 0,
      eligibleEncounters: 0,
      score: 0,
      actions: 0,
      timedOutTurns: 0,
      damage: 0,
      healing: 0,
      protection: 0,
      interrupts: 0,
      cleanses: 0,
      mechanics: 0,
    }]),
  );
  for (const contribution of run.contributions) {
    const aggregate = contributionByCharacter.get(contribution.characterId);
    if (!aggregate) continue;
    aggregate.encounters += 1;
    if (contribution.eligible) aggregate.eligibleEncounters += 1;
    aggregate.score += contribution.score;
    aggregate.actions += contribution.actions;
    aggregate.timedOutTurns += contribution.timedOutTurns;
    aggregate.damage += contribution.damage;
    aggregate.healing += contribution.healing;
    aggregate.protection += contribution.protection;
    aggregate.interrupts += contribution.interrupts;
    aggregate.cleanses += contribution.cleanses;
    aggregate.mechanics += contribution.mechanics;
  }
  const started = run.startedAt ? Date.parse(run.startedAt) : Number.NaN;
  const terminal = run.terminalAt ? Date.parse(run.terminalAt) : Number.NaN;
  const durationMs = Number.isFinite(started) && Number.isFinite(terminal)
    ? Math.max(0, terminal - started)
    : undefined;
  return {
    outcome: run.status,
    completionNodeKey: run.currentNodeKey,
    ...(run.status === 'FAILED' ? { failureNodeKey: run.currentNodeKey } : {}),
    groupSize: run.preparation.members.length,
    ...(run.startedAt ? { startedAt: run.startedAt } : {}),
    ...(run.terminalAt ? { terminalAt: run.terminalAt } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    visitedNodeKeys: [...run.visitedNodeKeys],
    decisions: structuredClone(run.decisions),
    economy: {
      securedSilver: sumSilver(run.securedLoot),
      pendingSilver: sumSilver(run.pendingLoot),
      securedItemQuantity: sumItems(run.securedLoot),
      pendingItemQuantity: sumItems(run.pendingLoot),
    },
    contributions: [...contributionByCharacter.values()],
    consequences: localizedConsequences(run.consequences),
  };
}

export function compileExpeditionCatalogView(
  definition: ExpeditionDefinition,
): ExpeditionCatalogView {
  return {
    key: definition.key,
    version: definition.version,
    contentVersion: definition.contentVersion,
    name: definition.name,
    minimumPartySize: definition.minimumPartySize,
    maximumPartySize: definition.maximumPartySize,
    recommendedPartySize: definition.recommendedPartySize,
    minimumCharacterLevel: minimumCharacterLevel(definition),
    preparationCost: structuredClone(definition.preparationCost),
    riskProfiles: structuredClone(definition.riskProfiles),
    difficultyProfiles: structuredClone(definition.difficultyProfiles),
    rotationPolicy: structuredClone(definition.rotationPolicy),
  };
}

function routeView(
  edge: ExpeditionRouteEdge,
  hiddenFields: ReadonlySet<string>,
): ExpeditionRouteView {
  return {
    key: edge.key,
    toNodeKey: edge.toNodeKey,
    threatType: edge.preview.threatType,
    ...(!hiddenFields.has('knownCost') && edge.preview.knownCost
      ? { knownCost: edge.preview.knownCost }
      : {}),
    ...(!hiddenFields.has('rewardCategory') && edge.preview.rewardCategory
      ? { rewardCategory: edge.preview.rewardCategory }
      : {}),
    ...(!hiddenFields.has('scoutHint') && edge.preview.scoutHint
      ? { scoutHint: edge.preview.scoutHint }
      : {}),
  };
}

export function compileExpeditionView(
  run: ExpeditionRunSnapshot,
  conditionEvaluator: (conditions: readonly NarrativeCondition[]) => boolean = () => true,
): ExpeditionPublicView {
  const node = run.definitionSnapshot.nodes.find((candidate) => candidate.key === run.currentNodeKey);
  if (!node) throw new Error('EXPEDITION_NODE_UNKNOWN');
  const difficulty = run.definitionSnapshot.difficultyProfiles.find(
    (profile) => profile.key === run.preparation.selectedDifficulty,
  );
  if (!difficulty) throw new Error('EXPEDITION_DIFFICULTY_UNKNOWN');
  const hiddenFields = new Set(difficulty.hiddenPreviewFields);
  const { members, ...preparation } = structuredClone(run.preparation);
  const report = finalReport(run);
  return {
    runId: run.runId,
    definition: {
      key: run.definitionKey,
      version: run.definitionVersion,
      contentVersion: run.contentVersion,
      name: run.definitionSnapshot.name,
      rotationVariantKey: run.rotationVariantKey,
    },
    status: run.status,
    revision: run.revision,
    party: members,
    preparation,
    acceptedRisk: structuredClone(run.riskSnapshot),
    currentNode: {
      key: node.key,
      type: node.type,
      title: node.title,
      description: node.description,
      checkpoint: Boolean(node.checkpoint),
      ...(node.terminal ? { terminal: node.terminal } : {}),
    },
    availableRoutes: run.status === 'ACTIVE'
      ? availableRoutes(run, (conditions) => conditionEvaluator(conditions)).map((edge) =>
          routeView(edge, hiddenFields),
        )
      : [],
    ritualChoices: node.type === 'RITUAL'
      ? (node.ritualChoices ?? []).map((choice) => ({
          key: choice.key,
          label: choice.label,
          disclosedEffect: choice.disclosedEffect,
        }))
      : [],
    resources: run.definitionSnapshot.resources.map((resource) => ({
      key: resource.key,
      label: resource.label,
      value: run.resources[resource.key] ?? resource.initial,
      minimum: resource.minimum,
      maximum: resource.maximum,
    })),
    activeModifiers: run.activeModifiers.map(modifierLabel),
    pendingLoot: structuredClone(run.pendingLoot),
    securedLoot: structuredClone(run.securedLoot),
    consequences: localizedConsequences(run.consequences),
    ...(run.pendingEncounter ? { pendingEncounter: structuredClone(run.pendingEncounter) } : {}),
    visitedNodeKeys: [...run.visitedNodeKeys],
    canExtract: run.status === 'ACTIVE' && node.type === 'EXTRACTION',
    reconnectable: run.definitionSnapshot.checkpointPolicy.reconnectAllowed,
    ...(report ? { finalReport: report } : {}),
  };
}
