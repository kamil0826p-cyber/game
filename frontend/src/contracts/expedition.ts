import type { CharacterClass } from './game';
import type { ClientToServerEvents, ServerToClientEvents, SocketAck } from './socket';

export type ExpeditionStatus =
  | 'PREPARING'
  | 'ACTIVE'
  | 'EXTRACTED'
  | 'FAILED'
  | 'ABANDONED'
  | 'COMPLETED';
export type ExpeditionDifficulty = 'BASE' | 'MASTERED' | 'RITUAL';

export interface ExpeditionRiskProfileView {
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

export interface ExpeditionDifficultyView {
  key: ExpeditionDifficulty;
  label: string;
  mechanics: string[];
  hiddenPreviewFields: Array<'knownCost' | 'rewardCategory' | 'scoutHint'>;
}

export interface ExpeditionCatalogView {
  key: string;
  version: number;
  contentVersion: string;
  name: string;
  minimumPartySize: number;
  maximumPartySize: number;
  recommendedPartySize: number;
  preparationCost: {
    silver: number;
    items: Array<{ itemKey: string; quantity: number }>;
  };
  riskProfiles: ExpeditionRiskProfileView[];
  difficultyProfiles: ExpeditionDifficultyView[];
  rotationPolicy: {
    cadence: 'WEEKLY' | 'SEASONAL';
    broadWindowDays: number;
    rotationVariantKeys: string[];
    coreRewardsRemainAvailable: true;
  };
}

export interface ExpeditionLootStackView {
  sourceKey: string;
  category: string;
  itemKey?: string;
  quantity?: number;
  silver?: number;
  core: boolean;
}

export interface ExpeditionMemberView {
  characterId: string;
  name: string;
  characterClass: CharacterClass;
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

export interface ExpeditionDecisionView {
  sequence: number;
  edgeKey: string;
  fromNodeKey: string;
  toNodeKey: string;
  operationId: string;
}

export interface ExpeditionFinalReportView {
  outcome: ExpeditionStatus;
  completionNodeKey: string;
  failureNodeKey?: string;
  groupSize: number;
  startedAt?: string;
  terminalAt?: string;
  durationMs?: number;
  visitedNodeKeys: string[];
  decisions: ExpeditionDecisionView[];
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
  consequences: Array<{ key: string; severity: number; sourceNodeKey: string }>;
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
  status: ExpeditionStatus;
  revision: number;
  party: ExpeditionMemberView[];
  preparation: {
    leaderCharacterId: string;
    selectedDifficulty: ExpeditionDifficulty;
    selectedRiskProfileKey: string;
    acceptedRiskVersion: number;
    insurancePurchased: boolean;
    formationKey: string;
    ritualChoices: Record<string, string>;
    declarativeRoles: Record<string, string>;
    lockedFields: string[];
  };
  acceptedRisk: ExpeditionRiskProfileView;
  currentNode: {
    key: string;
    type: string;
    title: string;
    description: string;
    checkpoint: boolean;
    terminal?: string;
  };
  availableRoutes: Array<{
    key: string;
    toNodeKey: string;
    threatType: string;
    knownCost?: string;
    rewardCategory?: string;
    scoutHint?: string;
  }>;
  ritualChoices: Array<{ key: string; label: string; disclosedEffect: string }>;
  resources: Array<{ key: string; label: string; value: number; minimum: number; maximum: number }>;
  activeModifiers: string[];
  pendingLoot: ExpeditionLootStackView[];
  securedLoot: ExpeditionLootStackView[];
  consequences: Array<{ key: string; severity: number; sourceNodeKey: string }>;
  pendingEncounter?: {
    nodeKey: string;
    encounterKey: string;
    encounterVersion: number;
    variantKey?: string;
  };
  visitedNodeKeys: string[];
  canExtract: boolean;
  reconnectable: boolean;
  finalReport?: ExpeditionFinalReportView;
}

export interface ExpeditionPreparePayload {
  operationId: string;
  definitionKey: string;
  definitionVersion?: number;
  difficulty: ExpeditionDifficulty;
  riskProfileKey: string;
  riskVersion: number;
  insurancePurchased: boolean;
  formationKey: string;
  roles: Record<string, { roleKey: string; formation: 'FRONT' | 'BACK' }>;
}

export interface ExpeditionMutationPayload {
  runId: string;
  operationId: string;
  expectedRevision: number;
}

declare module './socket' {
  interface ClientToServerEvents {
    'expedition:catalog': (
      payload: Record<string, never>,
      acknowledgement: (response: SocketAck<ExpeditionCatalogView[]>) => void,
    ) => void;
    'expedition:get': (
      payload: Record<string, never>,
      acknowledgement: (response: SocketAck<ExpeditionPublicView | null>) => void,
    ) => void;
    'expedition:prepare': (
      payload: ExpeditionPreparePayload,
      acknowledgement: (response: SocketAck<ExpeditionPublicView>) => void,
    ) => void;
    'expedition:start': (
      payload: ExpeditionMutationPayload,
      acknowledgement: (response: SocketAck<ExpeditionPublicView>) => void,
    ) => void;
    'expedition:advance': (
      payload: ExpeditionMutationPayload & { edgeKey: string },
      acknowledgement: (response: SocketAck<ExpeditionPublicView>) => void,
    ) => void;
    'expedition:ritual': (
      payload: ExpeditionMutationPayload & { choiceKey: string },
      acknowledgement: (response: SocketAck<ExpeditionPublicView>) => void,
    ) => void;
    'expedition:extract': (
      payload: ExpeditionMutationPayload,
      acknowledgement: (response: SocketAck<ExpeditionPublicView>) => void,
    ) => void;
    'expedition:abandon': (
      payload: ExpeditionMutationPayload,
      acknowledgement: (response: SocketAck<ExpeditionPublicView>) => void,
    ) => void;
  }

  interface ServerToClientEvents {
    'expedition:updated': (payload: ExpeditionPublicView) => void;
  }
}

export type ExpeditionClientToServerEvents = ClientToServerEvents;
export type ExpeditionServerToClientEvents = ServerToClientEvents;
