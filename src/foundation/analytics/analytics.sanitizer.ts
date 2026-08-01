const REDACTED = '[REDACTED]';
const REDACTED_EMAIL = '[REDACTED_EMAIL]';
const MAX_DEPTH = 20;
const MAX_ARRAY_ITEMS = 200;
const MAX_OBJECT_KEYS = 200;
const MAX_STRING_LENGTH = 4_096;

const sensitiveKey = (key: string, path: readonly string[]): boolean => {
  const normalized = key.replaceAll(/[^a-z0-9]/gi, '').toLowerCase();
  if (
    normalized.includes('password') ||
    normalized.includes('credential') ||
    normalized.includes('authorization') ||
    normalized.includes('cookie') ||
    normalized.includes('firebase') ||
    normalized.includes('refreshtoken') ||
    normalized.includes('accesstoken') ||
    normalized.includes('idtoken') ||
    normalized === 'token' ||
    normalized.includes('secret') ||
    normalized === 'email' ||
    normalized.endsWith('email') ||
    normalized === 'chat' ||
    normalized === 'message' ||
    normalized === 'chattext' ||
    normalized === 'messagetext' ||
    normalized.includes('chatcontent') ||
    normalized.includes('messagecontent')
  ) {
    return true;
  }
  const insideConversation = path.some((segment) => {
    const normalizedSegment = segment.toLowerCase();
    return normalizedSegment.includes('chat') || normalizedSegment.includes('message');
  });
  return (normalized === 'content' || normalized === 'message' || normalized === 'text') &&
    insideConversation;
};

const sanitizeString = (value: string): string => {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return REDACTED_EMAIL;
  return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…` : value;
};

export function sanitizeAnalyticsPayload(
  value: unknown,
  path: readonly string[] = [],
  depth = 0,
): unknown {
  if (depth > MAX_DEPTH) return '[MAX_DEPTH]';
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((entry, index) => sanitizeAnalyticsPayload(entry, [...path, String(index)], depth + 1));
  }
  if (typeof value !== 'object') return String(value);

  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS)) {
    output[key] = sensitiveKey(key, path)
      ? REDACTED
      : sanitizeAnalyticsPayload(nested, [...path, key], depth + 1);
  }
  return output;
}
