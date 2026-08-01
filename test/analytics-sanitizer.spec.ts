import { describe, expect, it } from 'vitest';
import {
  deterministicSample,
  sanitizeAnalyticsProperties,
  toAnalyticsEnvelope,
} from '../src/analytics/analytics-sanitizer.js';
import type { DomainEventRecord } from '../src/domain-events/domain-event.types.js';

const event: DomainEventRecord = {
  id: '00000000-0000-0000-0000-000000000001',
  deduplicationKey: 'SessionStarted:session-1',
  operationId: 'session-1',
  type: 'SessionStarted',
  schemaVersion: 1,
  actorCharacterId: null,
  realmId: null,
  mapId: null,
  regionKey: null,
  payload: {
    accountId: '00000000-0000-0000-0000-000000000002',
    sessionId: 'session-technical-id',
    email: 'private@example.test',
    chatMessage: 'must not leave the server',
    nested: { authToken: 'secret', safeCounter: 3 },
  },
  occurredAt: new Date('2026-08-01T00:00:00Z'),
  createdAt: new Date('2026-08-01T00:00:00Z'),
};

describe('analytics privacy and sampling', () => {
  it('removes PII, chat and credentials while retaining technical identifiers', () => {
    const envelope = toAnalyticsEnvelope({ event, contentVersion: 'content-v1', accountId: '00000000-0000-0000-0000-000000000002' });
    expect(envelope.accountId).toBe('00000000-0000-0000-0000-000000000002');
    expect(envelope.sessionId).toBe('session-technical-id');
    expect(envelope.properties).toEqual({
      accountId: '00000000-0000-0000-0000-000000000002',
      sessionId: 'session-technical-id',
      nested: { safeCounter: 3 },
    });
    expect(JSON.stringify(envelope)).not.toContain('private@example.test');
    expect(JSON.stringify(envelope)).not.toContain('must not leave');
    expect(JSON.stringify(envelope)).not.toContain('secret');
  });

  it('bounds nested and oversized values', () => {
    const result = sanitizeAnalyticsProperties({ safe: 'x'.repeat(1000), values: Array.from({ length: 100 }, (_, index) => index) });
    expect(String(result.safe)).toHaveLength(256);
    expect(result.values).toHaveLength(40);
  });

  it('samples deterministically', () => {
    const first = deterministicSample(event.id, 2500);
    expect(deterministicSample(event.id, 2500)).toBe(first);
    expect(deterministicSample(event.id, 10_000)).toBe(true);
    expect(deterministicSample(event.id, 0)).toBe(false);
  });
});
