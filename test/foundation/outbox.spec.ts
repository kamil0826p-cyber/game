import { describe, expect, it } from 'vitest';
import { deterministicEventId } from '../../src/foundation/events/deterministic-event-id.js';
import { isCriticalDomainEvent } from '../../src/foundation/events/domain-event.types.js';
import {
  deterministicSampleBucket,
  retryDelayMs,
} from '../../src/foundation/events/outbox.service.js';

describe('outbox policy', () => {
  it('uses bounded exponential retry delays', () => {
    expect(retryDelayMs(1)).toBe(1_000);
    expect(retryDelayMs(2)).toBe(2_000);
    expect(retryDelayMs(10)).toBe(512_000);
    expect(retryDelayMs(100)).toBe(3_600_000);
  });

  it('samples deterministically', () => {
    const id = '95c895d2-bd46-472f-9587-b230be331620';
    expect(deterministicSampleBucket(id)).toBe(deterministicSampleBucket(id));
    expect(deterministicSampleBucket(id)).toBeGreaterThanOrEqual(0);
    expect(deterministicSampleBucket(id)).toBeLessThan(10_000);
  });

  it('creates stable UUIDs for idempotent command events', () => {
    const identity = 'combat.action.accepted:request-123';
    const first = deterministicEventId(identity);
    expect(first).toBe(deterministicEventId(identity));
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first).not.toBe(
      deterministicEventId('combat.action.accepted:request-124'),
    );
  });

  it('never classifies economy and combat events as sampleable', () => {
    expect(isCriticalDomainEvent('economy.currency.changed')).toBe(true);
    expect(isCriticalDomainEvent('combat.action.accepted')).toBe(true);
    expect(isCriticalDomainEvent('item.acquired')).toBe(true);
    expect(isCriticalDomainEvent('session.started')).toBe(false);
  });
});
