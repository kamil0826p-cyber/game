import { createHash } from 'node:crypto';

export type FeatureFlagScope = 'ACCOUNT' | 'CHARACTER' | 'REALM' | 'GROUP' | 'GUILD';

export interface FeatureFlagVariant {
  key: string;
  weight: number;
}

export interface FeatureFlagDefinitionInput {
  key: string;
  version: number;
  scope: FeatureFlagScope;
  enabled: boolean;
  rolloutPercentage: number;
  salt: string;
  variants: readonly FeatureFlagVariant[];
}

export interface FeatureFlagResolution {
  variant: string;
  bucket: number;
  assigned: boolean;
  disabled: boolean;
}

export const validateFeatureFlagDefinition = (
  definition: FeatureFlagDefinitionInput,
): void => {
  if (!definition.key.trim()) throw new Error('Feature flag key is required.');
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error('Feature flag version must be a positive integer.');
  }
  if (definition.rolloutPercentage < 0 || definition.rolloutPercentage > 100) {
    throw new Error('Feature flag rolloutPercentage must be between 0 and 100.');
  }
  if (definition.variants.length === 0) {
    throw new Error('Feature flag must define at least one variant.');
  }
  if (
    new Set(definition.variants.map((variant) => variant.key)).size !==
    definition.variants.length
  ) {
    throw new Error('Feature flag variant keys must be unique.');
  }
  if (definition.variants.some((variant) => !variant.key || variant.weight <= 0)) {
    throw new Error('Feature flag variant weights must be positive.');
  }
};

const deterministicBucket = (input: string): number =>
  createHash('sha256').update(input).digest().readUInt32BE(0) % 10_000;

export const featureFlagBucket = (
  definition: Pick<FeatureFlagDefinitionInput, 'key' | 'version' | 'salt' | 'scope'>,
  scopeId: string,
): number =>
  deterministicBucket(
    `${definition.salt}:${definition.key}:${definition.version}:${definition.scope}:${scopeId}:rollout`,
  );

export const featureFlagVariantBucket = (
  definition: Pick<FeatureFlagDefinitionInput, 'key' | 'version' | 'salt' | 'scope'>,
  scopeId: string,
): number =>
  deterministicBucket(
    `${definition.salt}:${definition.key}:${definition.version}:${definition.scope}:${scopeId}:variant`,
  );

export const selectFeatureFlagVariant = (
  variants: readonly FeatureFlagVariant[],
  bucket: number,
): string => {
  const totalWeight = variants.reduce((sum, variant) => sum + variant.weight, 0);
  const weightedBucket = (bucket / 10_000) * totalWeight;
  let cursor = 0;
  for (const variant of variants) {
    cursor += variant.weight;
    if (weightedBucket < cursor) return variant.key;
  }
  return variants.at(-1)!.key;
};
