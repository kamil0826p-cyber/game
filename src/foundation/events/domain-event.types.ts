export const DOMAIN_EVENT_TYPES = [
  'account.created',
  'character.created',
  'session.started',
  'session.ended',
  'world.map.entered',
  'world.map.exited',
  'world.region.entered',
  'world.region.exited',
  'combat.started',
  'combat.action.accepted',
  'combat.finished',
  'progression.xp.changed',
  'progression.level.up',
  'item.acquired',
  'item.consumed',
  'item.destroyed',
  'item.traded',
  'economy.currency.changed',
  'quest.accepted',
  'quest.choice.made',
  'quest.completed',
  'quest.rewarded',
  'quest.failed',
  'group.created',
  'group.member.joined',
  'group.member.left',
  'group.disbanded',
  'guild.created',
  'guild.member.joined',
  'guild.member.left',
  'guild.disbanded',
  'regional.contribution.recorded',
  'expedition.started',
  'expedition.finished',
] as const;

export type KnownDomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];
export type DomainEventType = KnownDomainEventType | (string & {});

export interface DomainEventEnvelope<TPayload = unknown> {
  id: string;
  eventType: DomainEventType;
  eventVersion: number;
  occurredAt: Date;
  serverTime: Date;
  realmId?: string;
  mapId?: string;
  characterId?: string;
  accountId?: string;
  sessionId?: string;
  operationId?: string;
  correlationId?: string;
  contentHash?: string;
  clientVersion?: string;
  payload: TPayload;
}

export interface EmitDomainEventInput<TPayload = unknown> {
  id?: string;
  eventType: DomainEventType;
  eventVersion?: number;
  occurredAt?: Date;
  realmId?: string;
  mapId?: string;
  characterId?: string;
  accountId?: string;
  sessionId?: string;
  operationId?: string;
  correlationId?: string;
  contentHash?: string;
  clientVersion?: string;
  payload: TPayload;
}

const CRITICAL_EVENT_PREFIXES = [
  'combat.',
  'economy.',
  'item.',
  'quest.',
  'progression.',
] as const;

export function isCriticalDomainEvent(eventType: string): boolean {
  return CRITICAL_EVENT_PREFIXES.some((prefix) => eventType.startsWith(prefix));
}
