import type { DomainEventRecord } from '../domain-events/domain-event.types.js';

export const ANALYTICS_ENVELOPE_VERSION = 1;
export const ANALYTICS_CONSUMER = 'analytics-ingestion-v1';

export type AnalyticsProviderKind = 'disabled' | 'stdout' | 'http';
export type AnalyticsDeliveryStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED' | 'DEAD' | 'DISABLED';
export type ExperimentSubjectType = 'ACCOUNT' | 'CHARACTER' | 'REALM' | 'GROUP' | 'GUILD';

export interface AnalyticsEnvelope {
  envelopeVersion: typeof ANALYTICS_ENVELOPE_VERSION;
  eventId: string;
  eventName: string;
  sourceType: DomainEventRecord['type'];
  sourceSchemaVersion: number;
  serverTime: string;
  occurredAt: string;
  accountId?: string;
  characterId?: string;
  realmId?: string;
  mapId?: string;
  regionKey?: string;
  sessionId?: string;
  clientVersion?: string;
  contentVersion: string;
  operationId: string;
  correlationId: string;
  properties: Record<string, unknown>;
}

export interface ClaimedAnalyticsDelivery {
  id: string;
  analyticsEventId: string;
  attempts: number;
  envelope: AnalyticsEnvelope;
}

export interface AnalyticsProvider {
  readonly kind: Exclude<AnalyticsProviderKind, 'disabled'>;
  send(batch: readonly AnalyticsEnvelope[]): Promise<void>;
}

export interface ExperimentVariant {
  key: string;
  weight: number;
}

export interface ExperimentDefinition {
  key: string;
  version: number;
  status: 'ACTIVE' | 'DISABLED';
  rolloutBasisPoints: number;
  variants: ExperimentVariant[];
  salt: string;
  startsAt: Date | null;
  endsAt: Date | null;
}
