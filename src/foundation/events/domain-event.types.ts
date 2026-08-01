export const DOMAIN_EVENT_TYPES = {
  ACCOUNT_CREATED: 'account.created',
  CHARACTER_CREATED: 'character.created',
  SESSION_STARTED: 'session.started',
  SESSION_ENDED: 'session.ended',
  MAP_ENTERED: 'map.entered',
  MAP_LEFT: 'map.left',
  COMBAT_STARTED: 'combat.started',
  COMBAT_ACTION_ACCEPTED: 'combat.action.accepted',
  COMBAT_FINISHED: 'combat.finished',
  EXPERIENCE_GAINED: 'progression.experience.gained',
  LEVEL_UP: 'progression.level.up',
  ITEM_ACQUIRED: 'item.acquired',
  ITEM_CONSUMED: 'item.consumed',
  ITEM_DESTROYED: 'item.destroyed',
  ITEM_TRADED: 'item.traded',
  CURRENCY_CHANGED: 'currency.changed',
  QUEST_ACCEPTED: 'quest.accepted',
  QUEST_CHOICE: 'quest.choice',
  QUEST_COMPLETED: 'quest.completed',
  QUEST_REWARDED: 'quest.rewarded',
  GROUP_CREATED: 'group.created',
  GROUP_MEMBER_JOINED: 'group.member.joined',
  GROUP_MEMBER_LEFT: 'group.member.left',
  GUILD_CREATED: 'guild.created',
  GUILD_MEMBER_JOINED: 'guild.member.joined',
  GUILD_MEMBER_LEFT: 'guild.member.left',
  REGION_CONTRIBUTION: 'region.contribution',
  EXPEDITION_STARTED: 'expedition.started',
  EXPEDITION_FINISHED: 'expedition.finished',
} as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[keyof typeof DOMAIN_EVENT_TYPES] | string;

export interface DomainEventContext {
  realmId?: string;
  mapId?: string;
  characterId?: string;
  accountId?: string;
  sessionId?: string;
  operationId?: string;
  correlationId?: string;
  clientVersion?: string;
}

export interface DomainEventInput {
  type: DomainEventType;
  version: number;
  context?: DomainEventContext;
  payload: unknown;
  critical?: boolean;
}

export interface DomainEventEnvelope extends DomainEventContext {
  id: string;
  type: DomainEventType;
  version: number;
  occurredAt: Date;
  contentVersionHash?: string;
  payload: unknown;
  critical: boolean;
}
