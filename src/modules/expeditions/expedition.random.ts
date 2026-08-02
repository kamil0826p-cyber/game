function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

export function deterministicUnit(seed: number, ...parts: Array<string | number>): number {
  return hashText(`${seed}:${parts.join(':')}`) / 0x1_0000_0000;
}

export function deterministicPick<T extends { weight: number }>(
  values: readonly T[],
  seed: number,
  ...parts: Array<string | number>
): T | undefined {
  const eligible = values.filter((value) => Number.isFinite(value.weight) && value.weight > 0);
  const total = eligible.reduce((sum, value) => sum + value.weight, 0);
  if (total <= 0) return undefined;
  let cursor = deterministicUnit(seed, ...parts) * total;
  for (const value of eligible) {
    cursor -= value.weight;
    if (cursor <= 0) return value;
  }
  return eligible.at(-1);
}
