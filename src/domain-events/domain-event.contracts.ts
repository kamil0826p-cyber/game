import type { DomainAuditEntry, DomainContribution, DomainEventInput } from './domain-event.types.js';

export const DOMAIN_EVENT_CONTRACTS = {
  CombatCheckpointed: 1,
  CombatFinished: 1,
  MobDefeated: 1,
  ItemAcquired: 1,
  QuestChoiceMade: 1,
  QuestRewardGranted: 1,
  TradeCompleted: 1,
  RegionContributionAdded: 1,
} as const;

export type DomainEventType = keyof typeof DOMAIN_EVENT_CONTRACTS;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(payload: Record<string, unknown>, key: string, type: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Domain event ${type} requires payload.${key}.`);
  }
  return value;
}

function optionalString(payload: Record<string, unknown>, key: string, type: string): string | undefined {
  const value = payload[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Domain event ${type} payload.${key} must be a non-empty string.`);
  }
  return value;
}

function requiredPositiveInteger(payload: Record<string, unknown>, key: string, type: string): number {
  const value = payload[key];
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error(`Domain event ${type} requires positive integer payload.${key}.`);
  }
  return Number(value);
}

function requiredArray(payload: Record<string, unknown>, key: string, type: string): unknown[] {
  const value = payload[key];
  if (!Array.isArray(value)) throw new Error(`Domain event ${type} requires payload.${key} array.`);
  return value;
}

function validateParticipants(payload: Record<string, unknown>, type: string): void {
  const participants = requiredArray(payload, 'participants', type);
  if (participants.length < 1 || participants.length > 20) {
    throw new Error(`Domain event ${type} must contain 1-20 participants.`);
  }
  const seen = new Set<string>();
  for (const raw of participants) {
    if (!isRecord(raw)) throw new Error(`Domain event ${type} participant is malformed.`);
    const characterId = requiredString(raw, 'characterId', type);
    if (seen.has(characterId)) throw new Error(`Domain event ${type} repeats participant ${characterId}.`);
    seen.add(characterId);
    if (raw.team !== undefined && (!Number.isInteger(raw.team) || Number(raw.team) < 0 || Number(raw.team) > 1)) {
      throw new Error(`Domain event ${type} participant.team must be 0 or 1.`);
    }
  }
}

function validateContribution(value: DomainContribution): void {
  if (!['CHARACTER', 'PARTY', 'GUILD', 'REALM'].includes(value.subjectType)) {
    throw new Error(`Invalid contribution subject type ${value.subjectType}.`);
  }
  if (!value.subjectId.trim() || value.subjectId.length > 128) {
    throw new Error('Contribution subjectId must contain 1-128 characters.');
  }
  if (!value.kind.trim() || value.kind.length > 96) {
    throw new Error('Contribution kind must contain 1-96 characters.');
  }
  if (!Number.isInteger(value.amount) || value.amount < 1) {
    throw new Error('Contribution amount must be a positive integer.');
  }
  if (value.amount > 1_000_000) throw new Error('Contribution amount exceeds the safety limit.');
}

function validateAudit(value: DomainAuditEntry): void {
  if (!['SILVER', 'GOLD', 'XP', 'REPUTATION', 'ITEM', 'CONTRIBUTION'].includes(value.resourceType)) {
    throw new Error(`Invalid audit resource type ${value.resourceType}.`);
  }
  if (!Number.isInteger(value.amount) || value.amount === 0) {
    throw new Error('Audit amount must be a non-zero integer.');
  }
  if (!value.reason.trim() || value.reason.length > 96) {
    throw new Error('Audit reason must contain 1-96 characters.');
  }
  if (value.characterId !== undefined && (!value.characterId.trim() || value.characterId.length > 128)) {
    throw new Error('Audit characterId is invalid.');
  }
  if (value.resourceKey !== undefined && (!value.resourceKey.trim() || value.resourceKey.length > 128)) {
    throw new Error('Audit resourceKey is invalid.');
  }
}

export function validateDomainEventInput(input: DomainEventInput): void {
  if (!input.operationId.trim() || input.operationId.length > 160) {
    throw new Error('Domain event operationId must contain 1-160 characters.');
  }
  if (!(input.type in DOMAIN_EVENT_CONTRACTS)) {
    throw new Error(`Unknown domain event type ${input.type}.`);
  }
  const type = input.type as DomainEventType;
  const expectedVersion = DOMAIN_EVENT_CONTRACTS[type];
  const schemaVersion = input.schemaVersion ?? expectedVersion;
  if (schemaVersion !== expectedVersion) {
    throw new Error(`Domain event ${type} requires schema version ${expectedVersion}, got ${schemaVersion}.`);
  }
  if (!isRecord(input.payload)) throw new Error(`Domain event ${type} payload must be an object.`);

  switch (type) {
    case 'CombatCheckpointed':
    case 'CombatFinished':
      requiredString(input.payload, 'combatId', type);
      validateParticipants(input.payload, type);
      break;
    case 'MobDefeated':
      requiredString(input.payload, 'combatId', type);
      requiredString(input.payload, 'mobId', type);
      requiredString(input.payload, 'mobDefinitionKey', type);
      requiredString(input.payload, 'characterId', type);
      break;
    case 'ItemAcquired':
      requiredString(input.payload, 'characterId', type);
      requiredString(input.payload, 'itemKey', type);
      requiredString(input.payload, 'source', type);
      requiredPositiveInteger(input.payload, 'quantity', type);
      break;
    case 'QuestChoiceMade':
      requiredString(input.payload, 'characterId', type);
      requiredString(input.payload, 'npcKey', type);
      requiredString(input.payload, 'choiceId', type);
      optionalString(input.payload, 'questKey', type);
      break;
    case 'QuestRewardGranted':
      requiredString(input.payload, 'characterId', type);
      requiredString(input.payload, 'questKey', type);
      break;
    case 'TradeCompleted':
      requiredString(input.payload, 'tradeId', type);
      validateParticipants(input.payload, type);
      break;
    case 'RegionContributionAdded':
      requiredString(input.payload, 'regionKey', type);
      requiredString(input.payload, 'contributionKind', type);
      break;
  }

  for (const contribution of input.payload.contributions ?? []) validateContribution(contribution);
  for (const audit of input.payload.audit ?? []) validateAudit(audit);
}
