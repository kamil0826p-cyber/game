import type { NarrativeCondition } from '../narrative/narrative.types.js';

export const EXPEDITION_TEAM_LIMIT = 10;

export type ExpeditionRunStatus =
  | 'PREPARING'
  | 'ACTIVE'
  | 'EXTRACTED'
  | 'FAILED'
  | 'ABANDONED'
  | 'COMPLETED';

export type ExpeditionDifficulty = 'BASE' | 'MASTERED' | 'RITUAL';
export type ExpeditionDecisionPolicy = 'LEADER' | 'MAJORITY';
export type ExpeditionNodeType =
  | 'START'
  | 'COMBAT'
  | 'ELITE'
  | 'BOSS'
  | 'EVENT'
  | 'INVESTIGATION'
  | 'RITUAL'
  | 'CACHE'
  | 'REST'
  | 'HAZARD'
  | 'MERCHANT'
  | 'EXTRACTION'
  | 'BRANCH_GATE';

export interface ExpeditionThreatPreview {
  threatType: string;
  knownCost?: string;
  rewardCategory?: string;
  scoutHint?: string;
}

export interface ExpeditionResourceDelta {
  resourceKey: string;
  amount: number;
}

export interface ExpeditionRouteEdge {
  key: string;
  toNodeKey: string;
  preview: ExpeditionThreatPreview;
  costs?: ExpeditionResourceDelta[];
  conditions?: NarrativeCondition[];
}

export interface ExpeditionResourceDefinition {
  key: string;
  label: string;
  initial: number;
  minimum: number;
  maximum: number;
  failureAtMinimum?: boolean;
}

export interface ExpeditionRiskProfile {
  key: string;
  version: number;
  label: string;
  pendingLootLossPercent: number;
  maxConsequenceSeverity: number;
  consequencePool: string[];
  insuranceCostSilver: number;
  insurancePendingLootLossReductionPercent: number;
  insuranceConsequenceSeverityReduction: number;
  checkpointSecurityPercent: number;
}

export interface ExpeditionPreparationCost {
  silver: number;
  items: Array<{ itemKey: string; quantity: number }>;
}

export interface ExpeditionLootEntry {
  key: string;
  weight: number;
  category: string;
  core: boolean;
  itemKey?: string;
  quantity?: number;
  silver?: number;
}

export interface ExpeditionLootPool {
  key: string;
  rolls: number;
  entries: ExpeditionLootEntry[];
}

export interface ExpeditionEncounterPoolEntry {
  encounterKey: string;
  encounterVersion: number;
  weight: number;
  variantKey?: string;
  requiredRitualChoiceKey?: string;
}

export interface ExpeditionEncounterPool {
  key: string;
  entries: ExpeditionEncounterPoolEntry[];
}

export interface ExpeditionRitualChoice {
  key: string;
  label: string;
  disclosedEffect: string;
  encounterVariantKey?: string;
  resourceEffects?: ExpeditionResourceDelta[];
  corruptionDelta?: number;
  requiredToolItemKey?: string;
}

export interface ExpeditionNodeDefinition {
  key: string;
  type: ExpeditionNodeType;
  title: string;
  description: string;
  outgoing: ExpeditionRouteEdge[];
  encounterPoolKey?: string;
  lootPoolKey?: string;
  ritualChoices?: ExpeditionRitualChoice[];
  onSuccess?: ExpeditionResourceDelta[];
  onFailure?: ExpeditionResourceDelta[];
  checkpoint?: boolean;
  terminal?: 'EXTRACT' | 'COMPLETE' | 'FAIL';
}

export interface ExpeditionCheckpointPolicy {
  reconnectAllowed: boolean;
  replacementAllowed: boolean;
  secureOnCheckpoint: boolean;
  shutdownMode: 'PERSIST_ONLY' | 'SAFE_EXTRACT';
}

export interface ExpeditionDifficultyProfile {
  key: ExpeditionDifficulty;
  label: string;
  mechanics: string[];
  hiddenPreviewFields: Array<'knownCost' | 'rewardCategory' | 'scoutHint'>;
  extraResourcePressure?: ExpeditionResourceDelta[];
}

export interface ExpeditionRotationPolicy {
  cadence: 'WEEKLY' | 'SEASONAL';
  broadWindowDays: number;
  rotationVariantKeys: string[];
  coreRewardsRemainAvailable: true;
}

export interface ExpeditionRewardRules {
  distribution: 'PERSONAL';
  fullInventoryPolicy: 'CLAIM_QUEUE';
  terminalIdempotency: true;
  coreLootPoolKeys: string[];
}

export interface ExpeditionDefinition {
  key: string;
  version: number;
  contentVersion: string;
  name: string;
  minimumPartySize: number;
  maximumPartySize: number;
  recommendedPartySize: number;
  entryConditions: NarrativeCondition[];
  preparationCost: ExpeditionPreparationCost;
  decisionPolicy: ExpeditionDecisionPolicy;
  startNodeKey: string;
  nodes: ExpeditionNodeDefinition[];
  resources: ExpeditionResourceDefinition[];
  encounterPools: ExpeditionEncounterPool[];
  lootPools: ExpeditionLootPool[];
  riskProfiles: ExpeditionRiskProfile[];
  difficultyProfiles: ExpeditionDifficultyProfile[];
  checkpointPolicy: ExpeditionCheckpointPolicy;
  rewardRules: ExpeditionRewardRules;
  rotationPolicy: ExpeditionRotationPolicy;
  globalMutators: string[];
}

export interface ExpeditionMemberSnapshot {
  characterId: string;
  name: string;
  characterClass: 'MAGE' | 'WARRIOR' | 'ARCHER';
  level: number;
  roleKey: string;
  formation: 'FRONT' | 'BACK';
  loadout: {
    skillKeys: string[];
    fallbackAction: 'DEFEND' | 'BASIC_ATTACK' | 'SKIP';
    buildVersion: number;
    loadoutId?: string;
    equippedItemIds: string[];
    consumables: Array<{ itemKey: string; quantity: number }>;
    ritualToolItemKeys: string[];
  };
}

export interface ExpeditionPreparationSnapshot {
  leaderCharacterId: string;
  members: ExpeditionMemberSnapshot[];
  selectedDifficulty: ExpeditionDifficulty;
  selectedRiskProfileKey: string;
  acceptedRiskVersion: number;
  insurancePurchased: boolean;
  formationKey: string;
  ritualChoices: Record<string, string>;
  declarativeRoles: Record<string, string>;
  lockedFields: string[];
}

export interface ExpeditionLootStack {
  sourceKey: string;
  category: string;
  itemKey?: string;
  quantity?: number;
  silver?: number;
  core: boolean;
}

export interface ExpeditionDecisionRecord {
  sequence: number;
  edgeKey: string;
  fromNodeKey: string;
  toNodeKey: string;
  operationId: string;
}

export interface ExpeditionContributionRecord {
  combatId: string;
  encounterKey: string;
  encounterVersion: number;
  characterId: string;
  eligible: boolean;
  eligibilityReason: string;
  score: number;
  activeTurnRatio: number;
  actions: number;
  timedOutTurns: number;
  damage: number;
  healing: number;
  protection: number;
  interrupts: number;
  cleanses: number;
  mechanics: number;
}

export interface ExpeditionNodeResolution {
  nodeKey: string;
  encounter?: { encounterKey: string; encounterVersion: number; variantKey?: string };
  loot?: ExpeditionLootStack[];
  ritualChoiceKey?: string;
  resolvedAtRevision: number;
}

export interface ExpeditionRunSnapshot {
  runId: string;
  definitionKey: string;
  definitionVersion: number;
  contentVersion: string;
  definitionSnapshot: ExpeditionDefinition;
  seed: number;
  rotationVariantKey: string;
  createdAt: string;
  startedAt?: string;
  terminalAt?: string;
  status: ExpeditionRunStatus;
  preparation: ExpeditionPreparationSnapshot;
  riskSnapshot: ExpeditionRiskProfile;
  currentNodeKey: string;
  visitedNodeKeys: string[];
  resources: Record<string, number>;
  activeModifiers: string[];
  pendingLoot: ExpeditionLootStack[];
  securedLoot: ExpeditionLootStack[];
  consequences: Array<{ key: string; severity: number; sourceNodeKey: string }>;
  decisions: ExpeditionDecisionRecord[];
  contributions: ExpeditionContributionRecord[];
  nodeResolutions: Record<string, ExpeditionNodeResolution>;
  pendingEncounter?: { nodeKey: string; encounterKey: string; encounterVersion: number; variantKey?: string };
  processedOperations: Record<string, ExpeditionOperationResult>;
  revision: number;
}

export interface ExpeditionOperationResult {
  operationId: string;
  kind: 'START' | 'ADVANCE' | 'RESOLVE_NODE' | 'EXTRACT' | 'ABANDON';
  revision: number;
  status: ExpeditionRunStatus;
  nodeKey: string;
  lootAdded?: ExpeditionLootStack[];
  lootSecured?: ExpeditionLootStack[];
  encounter?: ExpeditionNodeResolution['encounter'];
}

export interface ExpeditionEncounterReference {
  key: string;
  version: number;
  maximumActors: number;
}

export interface ExpeditionValidationContext {
  encounters: ReadonlyMap<string, ExpeditionEncounterReference>;
  itemKeys: ReadonlySet<string>;
}

export interface ExpeditionValidationResult {
  errors: string[];
  warnings: string[];
}
