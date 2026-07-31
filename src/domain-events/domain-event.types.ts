import type { Prisma } from '../generated/prisma/client.js';
import type { DomainEventType } from './domain-event.contracts.js';

export type ContributionSubjectType = 'CHARACTER' | 'PARTY' | 'GUILD' | 'REALM';
export type AuditResourceType = 'SILVER' | 'GOLD' | 'XP' | 'REPUTATION' | 'ITEM' | 'CONTRIBUTION';

export interface DomainContribution {
  subjectType: ContributionSubjectType;
  subjectId: string;
  kind: string;
  amount: number;
  metadata?: Record<string, unknown>;
}

export interface DomainAuditEntry {
  characterId?: string;
  resourceType: AuditResourceType;
  resourceKey?: string;
  amount: number;
  balanceAfter?: number;
  reason: string;
  metadata?: Record<string, unknown>;
}

export interface DomainEventPayload extends Record<string, unknown> {
  contributions?: DomainContribution[];
  audit?: DomainAuditEntry[];
}

export interface DomainEventInput {
  eventId?: string;
  deduplicationKey?: string;
  operationId: string;
  type: DomainEventType;
  schemaVersion?: number;
  actorCharacterId?: string;
  realmId?: string;
  mapId?: string;
  regionKey?: string;
  occurredAt?: Date;
  payload: DomainEventPayload;
}

export interface DomainEventRecord {
  id: string;
  deduplicationKey: string;
  operationId: string;
  type: DomainEventType;
  schemaVersion: number;
  actorCharacterId: string | null;
  realmId: string | null;
  mapId: string | null;
  regionKey: string | null;
  payload: Prisma.JsonValue;
  occurredAt: Date;
  createdAt: Date;
}

export interface AppendedDomainEvent {
  event: DomainEventRecord;
  created: boolean;
}
