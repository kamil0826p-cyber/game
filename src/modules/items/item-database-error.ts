interface PrismaDatabaseErrorLike {
  code?: unknown;
  message?: unknown;
  meta?: unknown;
}

function containsMarker(value: unknown, marker: string): boolean {
  if (typeof value === 'string') return value.includes(marker);
  if (!value || typeof value !== 'object') return false;

  const metadata = value as Record<string, unknown>;
  return ['message', 'database_error', 'databaseError', 'cause'].some((key) =>
    typeof metadata[key] === 'string' && metadata[key].includes(marker),
  );
}

export function isPrismaDatabaseRuleError(
  error: unknown,
  code: string,
  marker: string,
): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as PrismaDatabaseErrorLike;
  return candidate.code === code && (
    containsMarker(candidate.message, marker) || containsMarker(candidate.meta, marker)
  );
}
