import { describe, expect, it } from 'vitest';
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

  it('never classifies economy and combat events as sampleable', () => {
    expect(isCriticalDomainEvent('economy.currency.changed')).toBe(true);
    expect(isCriticalDomainEvent('combat.action.accepted')).toBe(true);
    expect(isCriticalDomainEvent('item.acquired')).toBe(true);
    expect(isCriticalDomainEvent('session.started')).toBe(false);
  });
});
