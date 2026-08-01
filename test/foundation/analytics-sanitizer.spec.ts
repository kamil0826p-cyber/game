import { describe, expect, it } from 'vitest';
import { sanitizeAnalyticsPayload } from '../../src/foundation/analytics/analytics.sanitizer.js';

describe('analytics sanitizer', () => {
  it('recursively removes PII, credentials and chat content', () => {
    const sanitized = sanitizeAnalyticsPayload({
      email: 'player@example.com',
      nested: {
        authorization: 'Bearer secret',
        firebaseToken: 'firebase-secret',
        cookie: 'session=secret',
        chat: {
          content: 'private conversation',
          authorEmail: 'friend@example.com',
        },
        list: [{ access_token: 'token' }, { value: 'other@example.com' }],
      },
      safe: { characterId: 'character-1', amount: 10 },
    });

    expect(sanitized).toEqual({
      email: '[REDACTED]',
      nested: {
        authorization: '[REDACTED]',
        firebaseToken: '[REDACTED]',
        cookie: '[REDACTED]',
        chat: '[REDACTED]',
        list: [{ access_token: '[REDACTED]' }, { value: '[REDACTED_EMAIL]' }],
      },
      safe: { characterId: 'character-1', amount: 10 },
    });
  });

  it('bounds oversized strings and recursive structures', () => {
    const sanitized = sanitizeAnalyticsPayload({ value: 'x'.repeat(5_000) }) as {
      value: string;
    };
    expect(sanitized.value.length).toBe(4_097);
    expect(sanitized.value.endsWith('…')).toBe(true);
  });
});
