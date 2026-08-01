import { describe, expect, it } from 'vitest';
import {
  REDACTED_VALUE,
  sanitizeAnalyticsPayload,
} from '../../src/foundation/analytics/payload-sanitizer.js';

describe('analytics payload sanitizer', () => {
  it('redacts nested sensitive fields and token-like values recursively', () => {
    const sanitized = sanitizeAnalyticsPayload({
      safe: 'value',
      profile: {
        email: 'player@example.com',
        nested: [
          { authorization: 'Bearer secret-token' },
          { value: 'header.payload.signature' },
          { chatMessage: 'private text' },
        ],
      },
    });
    expect(sanitized).toEqual({
      safe: 'value',
      profile: {
        email: REDACTED_VALUE,
        nested: [
          { authorization: REDACTED_VALUE },
          { value: REDACTED_VALUE },
          { chatMessage: REDACTED_VALUE },
        ],
      },
    });
  });

  it('does not mutate the input and handles cycles', () => {
    const input: Record<string, unknown> = { safe: 'value' };
    input.self = input;
    const output = sanitizeAnalyticsPayload(input) as Record<string, unknown>;
    expect(output.safe).toBe('value');
    expect(output.self).toBe('[CIRCULAR]');
    expect(input.self).toBe(input);
  });
});
