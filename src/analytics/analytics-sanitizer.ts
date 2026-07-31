import { createHash } from 'node:crypto';
import type { DomainEventRecord } from '../domain-events/domain-event.types.js';
import { ANALYTICS_ENVELOPE_VERSION, type AnalyticsEnvelope } from './analytics.types.js';

const FORBIDDEN_KEY = /(?:^|_)(?:chat|message|text|body|content|email|firebase|token|password|secret|credential|authorization|cookie|private)(?:$|_)/i;
const MAX_DEPTH = 6;
const MAX_ARRAY_LENGTH = 40;
const MAX_OBJECT_KEYS = 80;
const MAX_STRING_LENGTH = 256;

const EVENT_NAMES: Partial<Record<DomainEventRecord['type'], string>> = {
  AccountRegistered: 'account.registered',
  CharacterCreated: 'character.created',
  SessionStarted: 'session.started',
  SessionEnded: 'session.ended',
  RegionEntered: 'region.entered',
  OnboardingCheckpointReached: 'onboarding.checkpoint',
  CombatStarted: 'combat.started',
  CombatActionAccepted: 'combat.action',
  CombatResolved: 'combat.finished',
  CombatDisconnected: 'combat.disconnected',
  CombatCheckpointed: 'combat.character_checkpoint',
  CombatFinished: 'combat.character_finished',
  MobDefeated: 'combat.mob_defeated',
  ItemAcquired: 'item.acquired',
  QuestChoiceMade: 'quest.choice',
  QuestRewardGranted: 'quest.reward',
  GroupJoined: 'group.joined',
  GuildJoined: 'guild.joined',
  TradeCompleted: 'trade.completed',
  CurrencyChanged: 'economy.currency_changed',
  CraftCompleted: 'craft.completed',
  ExpeditionFinished: 'expedition.finished',
  RegionContributionAdded: 'region.contribution',
};

export const CRITICAL_ANALYTICS_EVENTS = new Set<DomainEventRecord['type']>([
  'AccountRegistered',
  'CharacterCreated',
  'SessionStarted',
  'SessionEnded',
  'RegionEntered',
  'OnboardingCheckpointReached',
  'CombatStarted',
  'CombatResolved',
  'CombatDisconnected',
  'QuestChoiceMade',
  'GroupJoined',
  'GuildJoined',
  'CurrencyChanged',
]);

function normalizedKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase();
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.slice(0, MAX_STRING_LENGTH);
  if (depth >= MAX_DEPTH) return undefined;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH)
      .map((entry) => sanitizeValue(entry, depth + 1))
      .filter((entry) => entry !== undefined);
  }
  if (typeof value !== 'object') return undefined;
  const entries: Array<[string, unknown]> = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS)) {
    if (FORBIDDEN_KEY.test(normalizedKey(key))) continue;
    const sanitized = sanitizeValue(child, depth + 1);
    if (sanitized !== undefined) entries.push([key, sanitized]);
  }
  return Object.fromEntries(entries);
}

function optionalString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value.slice(0, 128) : undefined;
}

export function analyticsEventName(type: DomainEventRecord['type']): string {
  return EVENT_NAMES[type] ?? `domain.${String(type).replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()}`;
}

export function deterministicSample(eventId: string, basisPoints: number): boolean {
  if (basisPoints >= 10_000) return true;
  if (basisPoints <= 0) return false;
  const hash = createHash('sha256').update(eventId).digest();
  return hash.readUInt32BE(0) % 10_000 < basisPoints;
}

export function sanitizeAnalyticsProperties(payload: unknown): Record<string, unknown> {
  const sanitized = sanitizeValue(payload, 0);
  return typeof sanitized === 'object' && sanitized !== null && !Array.isArray(sanitized)
    ? sanitized as Record<string, unknown>
    : {};
}

export function toAnalyticsEnvelope(input: {
  event: DomainEventRecord;
  accountId?: string;
  contentVersion: string;
  ingestedAt?: Date;
}): AnalyticsEnvelope {
  const payload = input.event.payload as unknown as Record<string, unknown>;
  const characterId = input.event.actorCharacterId ?? optionalString(payload, 'characterId');
  const operationId = input.event.operationId;
  const sessionId = optionalString(payload, 'sessionId');
  const clientVersion = optionalString(payload, 'clientVersion');
  return {
    envelopeVersion: ANALYTICS_ENVELOPE_VERSION,
    eventId: input.event.id,
    eventName: analyticsEventName(input.event.type),
    sourceType: input.event.type,
    sourceSchemaVersion: input.event.schemaVersion,
    serverTime: (input.ingestedAt ?? new Date()).toISOString(),
    occurredAt: input.event.occurredAt.toISOString(),
    ...(input.accountId ? { accountId: input.accountId } : {}),
    ...(characterId ? { characterId } : {}),
    ...(input.event.realmId ? { realmId: input.event.realmId } : {}),
    ...(input.event.mapId ? { mapId: input.event.mapId } : {}),
    ...(input.event.regionKey ? { regionKey: input.event.regionKey } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(clientVersion ? { clientVersion } : {}),
    contentVersion: optionalString(payload, 'contentVersion') ?? input.contentVersion,
    operationId,
    correlationId: optionalString(payload, 'correlationId') ?? operationId,
    properties: sanitizeAnalyticsProperties(payload),
  };
}
