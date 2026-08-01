const SENSITIVE_KEY = /(^|[_-])(chat|message|content|email|authorization|cookie|token|firebase|secret|password|credential|session[_-]?cookie)s?($|[_-])/i;
const EMAIL_VALUE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BEARER_VALUE = /^bearer\s+[a-z0-9._~+/=-]+$/i;
const JWT_VALUE = /^[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+$/i;

export const REDACTED_VALUE = '[REDACTED]';

function sanitizeString(value: string): string {
  const trimmed = value.trim();
  if (EMAIL_VALUE.test(trimmed) || BEARER_VALUE.test(trimmed) || JWT_VALUE.test(trimmed)) {
    return REDACTED_VALUE;
  }
  return value;
}

export function sanitizeAnalyticsPayload(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return sanitizeString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeAnalyticsPayload(entry, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(key)
      ? REDACTED_VALUE
      : sanitizeAnalyticsPayload(entry, seen);
  }
  return result;
}
