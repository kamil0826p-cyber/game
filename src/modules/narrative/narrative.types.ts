export type NarrativeScalar = string | number | boolean;
export type NarrativeTerminalState =
  | 'SUCCESS'
  | 'PARTIAL_SUCCESS'
  | 'FAILURE'
  | 'ABANDONED'
  | 'BLOCKED';
export type NarrativeRepeatability = 'ONCE' | 'REPEATABLE' | 'COOLDOWN_BY_ACTIVITY';
export type NarrativeRelationDimension = 'TRUST' | 'FEAR' | 'DEBT' | 'GRUDGE';
export type NarrativeQuestStatus =
  | 'NOT_STARTED'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'REWARDED'
  | 'FAILED';
export type NarrativeConsequenceKind = 'WOUND' | 'CORRUPTION' | 'OATH';
export type NarrativeComparison = 'EQ' | 'NE' | 'GTE' | 'LTE';

export type NarrativeCondition =
  | { type: 'ALL'; conditions: NarrativeCondition[] }
  | { type: 'ANY'; conditions: NarrativeCondition[] }
  | { type: 'NOT'; condition: NarrativeCondition }
  | { type: 'LEVEL_AT_LEAST'; level: number }
  | { type: 'CLASS_IS'; characterClass: 'MAGE' | 'WARRIOR' | 'ARCHER' }
  | { type: 'SPECIALIZATION_IS'; specializationKey: string }
  | { type: 'ITEM_OWNED'; itemKey: string; quantity: number }
  | { type: 'ITEM_USED'; itemKey: string; quantity: number }
  | { type: 'QUEST_STATUS'; questKey: string; status: NarrativeQuestStatus }
  | { type: 'FLAG'; flagKey: string; comparison: 'EQ' | 'NE'; value: NarrativeScalar }
  | {
      type: 'NPC_RELATION';
      npcKey: string;
      dimension: NarrativeRelationDimension;
      comparison: NarrativeComparison;
      value: number;
    }
  | {
      type: 'FACTION_REPUTATION';
      factionKey: string;
      comparison: NarrativeComparison;
      value: number;
    }
  | {
      type: 'CONSEQUENCE';
      kind: NarrativeConsequenceKind;
      key?: string;
      comparison?: NarrativeComparison;
      value?: number | string;
    }
  | { type: 'GUILD_MEMBERSHIP'; required: boolean }
  | { type: 'GUILD_ROLE'; role: 'LEADER' | 'OFFICER' | 'MEMBER' }
  | { type: 'PARTY_SIZE'; comparison: NarrativeComparison; value: number }
  | { type: 'REGION_VALUE'; regionKey: string; valueKey: string; comparison: NarrativeComparison; value: number }
  | { type: 'WORLD_CYCLE'; cycleKey: string; phaseKey: string }
  | {
      type: 'ENCOUNTER_RESULT';
      encounterKey: string;
      result: 'VICTORY' | 'DEFEAT' | 'ESCAPED';
      mechanicKey?: string;
    };

export type NarrativeObjectiveType =
  | 'INTERACT_OBJECT'
  | 'INVESTIGATE'
  | 'DEFEND'
  | 'ESCORT'
  | 'USE_ITEM_AT_LOCATION'
  | 'PERFORM_RITUAL'
  | 'MAKE_CHOICE'
  | 'CRAFT_ITEM'
  | 'CONTRIBUTE_RESOURCE'
  | 'COMPLETE_ENCOUNTER_WITH_CONDITION'
  | 'REACH_LOCATION'
  | 'SURVIVE'
  | 'FAIL_FORWARD';

export interface NarrativeObjectiveDefinition {
  key: string;
  type: NarrativeObjectiveType;
  targetKey?: string;
  quantity: number;
  mapKey?: string;
  x?: number;
  y?: number;
  radius?: number;
  conditionKey?: string;
  authoritativeEventType: NarrativeAuthoritativeEvent['type'];
}

export type NarrativeEffect =
  | { type: 'SET_FLAG'; operationKey: string; flagKey: string; value: NarrativeScalar; reason: string }
  | { type: 'REMOVE_FLAG'; operationKey: string; flagKey: string; reason: string }
  | {
      type: 'ADJUST_RELATION';
      operationKey: string;
      npcKey: string;
      dimension: NarrativeRelationDimension;
      delta: number;
      reason: string;
    }
  | {
      type: 'ADJUST_REPUTATION';
      operationKey: string;
      factionKey: string;
      delta: number;
      sourceKey: string;
      reason: string;
    }
  | {
      type: 'GRANT_RESOURCE' | 'TAKE_RESOURCE';
      operationKey: string;
      resourceKey: string;
      amount: number;
      reason: string;
    }
  | {
      type: 'SET_QUEST_STATE';
      operationKey: string;
      questKey: string;
      state: 'ACTIVE' | 'COMPLETED' | 'FAILED';
      reason: string;
    }
  | {
      type: 'SET_SERVICE_ACCESS';
      operationKey: string;
      serviceKey: string;
      allowed: boolean;
      reason: string;
    }
  | {
      type: 'ACTIVATE_ENCOUNTER';
      operationKey: string;
      encounterKey: string;
      reason: string;
    }
  | {
      type: 'CONTRIBUTE_REGION';
      operationKey: string;
      regionKey: string;
      valueKey: string;
      amount: number;
      reason: string;
    }
  | {
      type: 'SET_ACCESS_POLICY';
      operationKey: string;
      policyKey: string;
      allowed: boolean;
      reason: string;
    }
  | {
      type: 'APPLY_CONSEQUENCE' | 'REMOVE_CONSEQUENCE';
      operationKey: string;
      consequenceKind: NarrativeConsequenceKind;
      consequenceKey: string;
      amount?: number;
      reason: string;
    }
  | {
      type: 'SELECT_OUTCOME';
      operationKey: string;
      outcomeKey: string;
      reason: string;
    };

export interface NarrativeChoiceDefinition {
  key: string;
  label: string | { en: string; pl: string };
  conditions?: NarrativeCondition[];
  knownEffects: NarrativeEffect[];
  hiddenEffects?: NarrativeEffect[];
  nextNodeKey?: string;
  outcomeKey?: string;
}

export interface NarrativeNodeDefinition {
  key: string;
  chapterKey: string;
  conditions?: NarrativeCondition[];
  objectives?: NarrativeObjectiveDefinition[];
  choices?: NarrativeChoiceDefinition[];
  onCompleteEffects?: NarrativeEffect[];
  nextNodeKey?: string;
  failForwardNodeKey?: string;
  terminalOutcomeKey?: string;
}

export interface NarrativeOutcomeDefinition {
  key: string;
  terminalState: NarrativeTerminalState;
  rewardProfileKey?: string;
  effects: NarrativeEffect[];
}

export interface NarrativeDialogueRootDefinition {
  key: string;
  nodeId: string;
  priority: number;
  conditions: NarrativeCondition[];
}

export interface NarrativeDefinition {
  key: string;
  version: number;
  startNodeKey: string;
  repeatability: NarrativeRepeatability;
  mutuallyExclusivePathKeys: string[];
  nodes: NarrativeNodeDefinition[];
  outcomes: NarrativeOutcomeDefinition[];
  factionPolicies?: FactionPolicy[];
  dialogueRoots?: NarrativeDialogueRootDefinition[];
}

export interface NpcRelationState {
  TRUST: number;
  FEAR: number;
  DEBT: number;
  GRUDGE: number;
}

export interface FactionReputationState {
  value: number;
  sourceCounts: Record<string, number>;
  tags: string[];
}

export interface NarrativeConsequenceState {
  wounds: Record<string, number>;
  corruption: number;
  oaths: Record<string, 'ACTIVE' | 'KEPT' | 'BROKEN' | 'REDEEMED'>;
}

export interface CharacterNarrativeState {
  flags: Record<string, NarrativeScalar>;
  usedItems: Record<string, number>;
  questStatuses: Record<string, NarrativeQuestStatus>;
  npcRelations: Record<string, NpcRelationState>;
  factionReputations: Record<string, FactionReputationState>;
  serviceAccess: Record<string, boolean>;
  accessPolicies: Record<string, boolean>;
  consequences: NarrativeConsequenceState;
  specializationKey?: string;
  guild?: { role: 'LEADER' | 'OFFICER' | 'MEMBER' };
}

export interface NarrativeConditionContext {
  level: number;
  characterClass: 'MAGE' | 'WARRIOR' | 'ARCHER';
  inventory: ReadonlyMap<string, number>;
  partySize: number;
  character: CharacterNarrativeState;
  regionValues: ReadonlyMap<string, ReadonlyMap<string, number>>;
  worldCycles: ReadonlyMap<string, string>;
  encounterResults: ReadonlyMap<
    string,
    { result: 'VICTORY' | 'DEFEAT' | 'ESCAPED'; mechanics: ReadonlySet<string> }
  >;
}

export interface FactionPolicy {
  key: string;
  hostileWith: string[];
  mutualPositiveCap: number;
}

export interface NarrativeAuditEvent {
  operationId: string;
  eventType: string;
  reason: string;
  payload: Record<string, unknown>;
}

export interface NarrativeEffectApplication {
  state: CharacterNarrativeState;
  audits: NarrativeAuditEvent[];
  externalEffects: NarrativeEffect[];
}

export interface QuestNarrativeProgress {
  definitionKey: string;
  definitionVersion: number;
  definitionSnapshot: NarrativeDefinition;
  currentNodeKey: string;
  choices: Record<string, string>;
  objectiveCounters: Record<string, number>;
  processedEvents: Record<string, NarrativeEventResult>;
  processedChoices: Record<string, NarrativeChoiceResult>;
  outcomeKey?: string;
  terminalState?: NarrativeTerminalState;
}

export interface NarrativeChoiceResult {
  operationId: string;
  nodeKey: string;
  optionKey: string;
  knownEffects: NarrativeEffect[];
  nextNodeKey?: string;
  outcomeKey?: string;
  terminalState?: NarrativeTerminalState;
}

export interface NarrativeEventResult {
  operationId: string;
  matchedObjectiveKeys: string[];
  completedObjectiveKeys: string[];
  nextNodeKey?: string;
  outcomeKey?: string;
  terminalState?: NarrativeTerminalState;
}

export type NarrativeAuthoritativeEvent =
  | { type: 'OBJECT_INTERACTED'; operationId: string; objectKey: string; mapKey: string; x: number; y: number }
  | { type: 'CLUE_INSPECTED'; operationId: string; clueKey: string; mapKey: string }
  | { type: 'ENCOUNTER_DEFENDED'; operationId: string; encounterKey: string }
  | { type: 'ESCORT_COMPLETED'; operationId: string; npcKey: string; destinationKey: string }
  | { type: 'ITEM_USED_AT_LOCATION'; operationId: string; itemKey: string; mapKey: string; x: number; y: number }
  | { type: 'RITUAL_PERFORMED'; operationId: string; ritualKey: string }
  | { type: 'CHOICE_MADE'; operationId: string; choiceKey: string }
  | { type: 'ITEM_CRAFTED'; operationId: string; itemKey: string; quantity: number }
  | { type: 'RESOURCE_CONTRIBUTED'; operationId: string; resourceKey: string; quantity: number; regionKey: string }
  | { type: 'ENCOUNTER_COMPLETED'; operationId: string; encounterKey: string; conditionKeys: string[]; result: 'VICTORY' | 'DEFEAT' | 'ESCAPED' }
  | { type: 'LOCATION_REACHED'; operationId: string; mapKey: string; x: number; y: number }
  | { type: 'SURVIVED'; operationId: string; encounterKey: string }
  | { type: 'FAILURE_RESOLVED'; operationId: string; failureKey: string };

export interface RegionNarrativeState {
  revision: number;
  values: Record<string, number>;
  characterContributions: Record<string, number>;
  groupContributions: Record<string, number>;
  guildContributions: Record<string, number>;
  processedOperations: Record<string, RegionContributionResult>;
}

export interface RegionContributionPolicy {
  minimumMeaningfulAmount: number;
  perCharacterCap: number;
  perGroupCap: number;
  perGuildCap: number;
}

export interface RegionContributionRequest {
  operationId: string;
  characterId: string;
  groupId?: string;
  guildId?: string;
  valueKey: string;
  amount: number;
  qualified: boolean;
  afk: boolean;
  reason: string;
}

export interface RegionContributionResult {
  operationId: string;
  accepted: boolean;
  appliedAmount: number;
  revision: number;
  reason: string;
}
