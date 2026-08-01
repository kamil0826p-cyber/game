import { createHash } from 'node:crypto';

export type FeatureFlagScope = 'ACCOUNT' | 'CHARACTER' | 'REALM' | 'GROUP' | 'GUILD';

export interface FeatureFlagVariant {
  key: string;
  weight: number;
}

export function stableFeatureBucket(value: string): number {
  return createHash('sha256').update(value).digest().readUInt32BE(0) % 10_000;
}

export function validateFeatureVariants(input: unknown): FeatureFlagVariant[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('Feature flag variants must be a non-empty array.');
  }
  const variants = input.map((entry): FeatureFlagVariant => {
    if (!entry || typeof entry !== 'object') throw new Error('Feature flag variant is malformed.');
    const { key, weight } = entry as { key?: unknown; weight?: unknown };
    if (typeof key !== 'string' || !key.trim() || key.length > 128) {
      throw new Error('Feature flag variant key must contain 1-128 characters.');
    }
    if (!Number.isInteger(weight) || Number(weight) <= 0 || Number(weight) > 10_000) {
      throw new Error(`Feature flag variant ${key} has an invalid weight.`);
    }
    return { key, weight: Number(weight) };
  });
  const total = variants.reduce((sum, variant) => sum + variant.weight, 0);
  if (total !== 10_000) throw new Error(`Feature flag variant weights must sum to 10000, received ${total}.`);
  if (new Set(variants.map((variant) => variant.key)).size !== variants.length) {
    throw new Error('Feature flag variant keys must be unique.');
  }
  return variants;
}

export function selectFeatureVariant(
  variants: readonly FeatureFlagVariant[],
  bucket: number,
): string {
  let cursor = 0;
  for (const variant of variants) {
    cursor += variant.weight;
    if (bucket < cursor) return variant.key;
  }
  return variants.at(-1)?.key ?? 'control';
}
