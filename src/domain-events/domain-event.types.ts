import type { Prisma } from '../generated/prisma/client.js';

export type ContributionSubjectType = 'CHARACTER' | 'PARTY' | 'GUILD' | 'REALM';

export interface DomainContribution {
  subjectType: ContributionSubjectType;
  subjectId: string;
  kind: string;
  amount: number;
  metadata?: Record<string, unknown>;
}

export interface DomainEventInput {
  eventId?: string;
  deduplicationKey?: string;
  operationId: string;
  type: string;
  schemaVersion?: number;
  actorCharacterId?: string;
  realmId?: string;
  mapId?: string;
  regionKey?: string;
  occurredAt?: Date;
  payload: Record<string, unknown> & { contributions?: DomainContribution[] };
}

export interface DomainEventRecord {
  id: string;
  deduplicationKey: string;
  operationId: string;
  type: string;
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
