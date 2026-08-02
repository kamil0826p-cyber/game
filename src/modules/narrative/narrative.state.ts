import type {
  CharacterNarrativeState,
  FactionPolicy,
  FactionReputationState,
  NarrativeAuditEvent,
  NarrativeEffect,
  NarrativeEffectApplication,
  NarrativeRelationDimension,
  NarrativeScalar,
  NpcRelationState,
  RegionContributionPolicy,
  RegionContributionRequest,
  RegionContributionResult,
  RegionNarrativeState,
} from './narrative.types.js';

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, Math.trunc(value)));

const emptyRelation = (): NpcRelationState => ({ TRUST: 0, FEAR: 0, DEBT: 0, GRUDGE: 0 });
const emptyReputation = (): FactionReputationState => ({ value: 0, sourceCounts: {}, tags: [] });

export function emptyCharacterNarrativeState(): CharacterNarrativeState {
  return {
    flags: {},
    usedItems: {},
    questStatuses: {},
    npcRelations: {},
    factionReputations: {},
    serviceAccess: {},
    accessPolicies: {},
    consequences: { wounds: {}, corruption: 0, oaths: {} },
  };
}

export function parseCharacterNarrativeState(value: unknown): CharacterNarrativeState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyCharacterNarrativeState();
  const source = value as Partial<CharacterNarrativeState>;
  const base = emptyCharacterNarrativeState();
  return {
    ...base,
    ...source,
    flags: isRecord(source.flags) ? (source.flags as Record<string, NarrativeScalar>) : {},
    usedItems: numericRecord(source.usedItems),
    questStatuses: isRecord(source.questStatuses) ? source.questStatuses : {},
    npcRelations: relationRecord(source.npcRelations),
    factionReputations: reputationRecord(source.factionReputations),
    serviceAccess: booleanRecord(source.serviceAccess),
    accessPolicies: booleanRecord(source.accessPolicies),
    consequences: parseConsequences(source.consequences),
    specializationKey: typeof source.specializationKey === 'string' ? source.specializationKey : undefined,
    guild:
      source.guild && ['LEADER', 'OFFICER', 'MEMBER'].includes(source.guild.role)
        ? { role: source.guild.role }
        : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numericRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) if (Number.isFinite(raw)) result[key] = Number(raw);
  return result;
}

function booleanRecord(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};
  const result: Record<string, boolean> = {};
  for (const [key, raw] of Object.entries(value)) if (typeof raw === 'boolean') result[key] = raw;
  return result;
}

function relationRecord(value: unknown): Record<string, NpcRelationState> {
  if (!isRecord(value)) return {};
  const result: Record<string, NpcRelationState> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue;
    result[key] = {
      TRUST: clamp(Number(raw.TRUST ?? 0), -100, 100),
      FEAR: clamp(Number(raw.FEAR ?? 0), -100, 100),
      DEBT: clamp(Number(raw.DEBT ?? 0), -100, 100),
      GRUDGE: clamp(Number(raw.GRUDGE ?? 0), -100, 100),
    };
  }
  return result;
}

function reputationRecord(value: unknown): Record<string, FactionReputationState> {
  if (!isRecord(value)) return {};
  const result: Record<string, FactionReputationState> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue;
    result[key] = {
      value: clamp(Number(raw.value ?? 0), -100, 100),
      sourceCounts: numericRecord(raw.sourceCounts),
      tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    };
  }
  return result;
}

function parseConsequences(value: unknown): CharacterNarrativeState['consequences'] {
  if (!isRecord(value)) return { wounds: {}, corruption: 0, oaths: {} };
  const oaths: CharacterNarrativeState['consequences']['oaths'] = {};
  if (isRecord(value.oaths)) {
    for (const [key, raw] of Object.entries(value.oaths)) {
      if (raw === 'ACTIVE' || raw === 'KEPT' || raw === 'BROKEN' || raw === 'REDEEMED') oaths[key] = raw;
    }
  }
  return {
    wounds: numericRecord(value.wounds),
    corruption: clamp(Number(value.corruption ?? 0), 0, 100),
    oaths,
  };
}

function copyState(state: CharacterNarrativeState): CharacterNarrativeState {
  return {
    ...state,
    flags: { ...state.flags },
    usedItems: { ...state.usedItems },
    questStatuses: { ...state.questStatuses },
    npcRelations: Object.fromEntries(
      Object.entries(state.npcRelations).map(([key, relation]) => [key, { ...relation }]),
    ),
    factionReputations: Object.fromEntries(
      Object.entries(state.factionReputations).map(([key, reputation]) => [
        key,
        { ...reputation, sourceCounts: { ...reputation.sourceCounts }, tags: [...reputation.tags] },
      ]),
    ),
    serviceAccess: { ...state.serviceAccess },
    accessPolicies: { ...state.accessPolicies },
    consequences: {
      wounds: { ...state.consequences.wounds },
      corruption: state.consequences.corruption,
      oaths: { ...state.consequences.oaths },
    },
    guild: state.guild ? { ...state.guild } : undefined,
  };
}

function audit(effect: NarrativeEffect, payload: Record<string, unknown>): NarrativeAuditEvent {
  return {
    operationId: effect.operationKey,
    eventType: effect.type,
    reason: effect.reason,
    payload,
  };
}

function relationDelta(
  state: CharacterNarrativeState,
  npcKey: string,
  dimension: NarrativeRelationDimension,
  delta: number,
): number {
  const relation = { ...(state.npcRelations[npcKey] ?? emptyRelation()) };
  relation[dimension] = clamp(relation[dimension] + delta, -100, 100);
  state.npcRelations[npcKey] = relation;
  return relation[dimension];
}

function diminishedDelta(delta: number, repeatedCount: number): number {
  if (delta <= 0) return Math.trunc(delta);
  return Math.max(1, Math.floor(delta / (1 + repeatedCount / 3)));
}

function adjustReputation(
  state: CharacterNarrativeState,
  factionKey: string,
  delta: number,
  sourceKey: string,
  policies: ReadonlyMap<string, FactionPolicy>,
): { value: number; appliedDelta: number; hostileChanges: Record<string, number> } {
  const current = state.factionReputations[factionKey] ?? emptyReputation();
  const repeatedCount = current.sourceCounts[sourceKey] ?? 0;
  const appliedDelta = diminishedDelta(delta, repeatedCount);
  const next = {
    ...current,
    value: clamp(current.value + appliedDelta, -100, 100),
    sourceCounts: { ...current.sourceCounts, [sourceKey]: repeatedCount + 1 },
    tags: [...current.tags],
  };
  state.factionReputations[factionKey] = next;

  const hostileChanges: Record<string, number> = {};
  const policy = policies.get(factionKey);
  if (appliedDelta > 0 && policy) {
    for (const hostileKey of policy.hostileWith) {
      const hostile = state.factionReputations[hostileKey] ?? emptyReputation();
      if (next.value <= policy.mutualPositiveCap || hostile.value <= policy.mutualPositiveCap) continue;
      const reduced = clamp(hostile.value - appliedDelta, -100, 100);
      state.factionReputations[hostileKey] = { ...hostile, value: reduced, sourceCounts: { ...hostile.sourceCounts }, tags: [...hostile.tags] };
      hostileChanges[hostileKey] = reduced - hostile.value;
    }
  }
  return { value: next.value, appliedDelta, hostileChanges };
}

export function applyNarrativeEffects(
  initialState: CharacterNarrativeState,
  effects: readonly NarrativeEffect[],
  factionPolicies: ReadonlyMap<string, FactionPolicy> = new Map(),
): NarrativeEffectApplication {
  const state = copyState(initialState);
  const audits: NarrativeAuditEvent[] = [];
  const externalEffects: NarrativeEffect[] = [];
  const seenOperationKeys = new Set<string>();

  for (const effect of effects) {
    if (seenOperationKeys.has(effect.operationKey)) continue;
    seenOperationKeys.add(effect.operationKey);
    switch (effect.type) {
      case 'SET_FLAG':
        state.flags[effect.flagKey] = effect.value;
        audits.push(audit(effect, { flagKey: effect.flagKey, value: effect.value }));
        break;
      case 'REMOVE_FLAG':
        delete state.flags[effect.flagKey];
        audits.push(audit(effect, { flagKey: effect.flagKey }));
        break;
      case 'ADJUST_RELATION': {
        const value = relationDelta(state, effect.npcKey, effect.dimension, effect.delta);
        audits.push(audit(effect, { npcKey: effect.npcKey, dimension: effect.dimension, delta: effect.delta, value }));
        break;
      }
      case 'ADJUST_REPUTATION': {
        const result = adjustReputation(state, effect.factionKey, effect.delta, effect.sourceKey, factionPolicies);
        audits.push(audit(effect, { factionKey: effect.factionKey, ...result }));
        break;
      }
      case 'SET_SERVICE_ACCESS':
        state.serviceAccess[effect.serviceKey] = effect.allowed;
        audits.push(audit(effect, { serviceKey: effect.serviceKey, allowed: effect.allowed }));
        break;
      case 'SET_ACCESS_POLICY':
        state.accessPolicies[effect.policyKey] = effect.allowed;
        audits.push(audit(effect, { policyKey: effect.policyKey, allowed: effect.allowed }));
        break;
      case 'APPLY_CONSEQUENCE':
      case 'REMOVE_CONSEQUENCE':
      case 'GRANT_RESOURCE':
      case 'TAKE_RESOURCE':
      case 'SET_QUEST_STATE':
      case 'ACTIVATE_ENCOUNTER':
      case 'CONTRIBUTE_REGION':
      case 'SELECT_OUTCOME':
        externalEffects.push(effect);
        audits.push(audit(effect, { delegated: true }));
        break;
      default: {
        const exhaustive: never = effect;
        throw new Error(`Unsupported narrative effect: ${String(exhaustive)}`);
      }
    }
  }
  return { state, audits, externalEffects };
}

export function emptyRegionNarrativeState(): RegionNarrativeState {
  return {
    revision: 0,
    values: {},
    characterContributions: {},
    groupContributions: {},
    guildContributions: {},
    processedOperations: {},
  };
}

export function parseRegionNarrativeState(value: unknown): RegionNarrativeState {
  if (!isRecord(value)) return emptyRegionNarrativeState();
  return {
    revision: Math.max(0, Math.trunc(Number(value.revision ?? 0))),
    values: numericRecord(value.values),
    characterContributions: numericRecord(value.characterContributions),
    groupContributions: numericRecord(value.groupContributions),
    guildContributions: numericRecord(value.guildContributions),
    processedOperations: isRecord(value.processedOperations)
      ? (value.processedOperations as RegionNarrativeState['processedOperations'])
      : {},
  };
}

export function applyRegionContribution(
  initialState: RegionNarrativeState,
  request: RegionContributionRequest,
  policy: RegionContributionPolicy,
): { state: RegionNarrativeState; result: RegionContributionResult } {
  const previous = initialState.processedOperations[request.operationId];
  if (previous) return { state: initialState, result: previous };

  const state: RegionNarrativeState = {
    revision: initialState.revision,
    values: { ...initialState.values },
    characterContributions: { ...initialState.characterContributions },
    groupContributions: { ...initialState.groupContributions },
    guildContributions: { ...initialState.guildContributions },
    processedOperations: { ...initialState.processedOperations },
  };
  const reject = (reason: string): { state: RegionNarrativeState; result: RegionContributionResult } => {
    const result = { operationId: request.operationId, accepted: false, appliedAmount: 0, revision: state.revision, reason };
    state.processedOperations[request.operationId] = result;
    return { state, result };
  };
  if (!request.qualified) return reject('UNQUALIFIED');
  if (request.afk) return reject('AFK');
  if (!Number.isInteger(request.amount) || request.amount < policy.minimumMeaningfulAmount) return reject('BELOW_MINIMUM');

  const characterUsed = state.characterContributions[request.characterId] ?? 0;
  const characterRemaining = Math.max(0, policy.perCharacterCap - characterUsed);
  const groupUsed = request.groupId ? state.groupContributions[request.groupId] ?? 0 : 0;
  const groupRemaining = request.groupId ? Math.max(0, policy.perGroupCap - groupUsed) : request.amount;
  const guildUsed = request.guildId ? state.guildContributions[request.guildId] ?? 0 : 0;
  const guildRemaining = request.guildId ? Math.max(0, policy.perGuildCap - guildUsed) : request.amount;
  const appliedAmount = Math.min(request.amount, characterRemaining, groupRemaining, guildRemaining);
  if (appliedAmount < policy.minimumMeaningfulAmount) return reject('CONTRIBUTION_CAP_REACHED');

  state.values[request.valueKey] = (state.values[request.valueKey] ?? 0) + appliedAmount;
  state.characterContributions[request.characterId] = characterUsed + appliedAmount;
  if (request.groupId) state.groupContributions[request.groupId] = groupUsed + appliedAmount;
  if (request.guildId) state.guildContributions[request.guildId] = guildUsed + appliedAmount;
  state.revision += 1;
  const result: RegionContributionResult = {
    operationId: request.operationId,
    accepted: true,
    appliedAmount,
    revision: state.revision,
    reason: request.reason,
  };
  state.processedOperations[request.operationId] = result;
  return { state, result };
}
