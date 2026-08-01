import { describe, expect, it } from 'vitest';
import {
  featureFlagBucket,
  featureFlagVariantBucket,
  selectFeatureFlagVariant,
} from '../../src/foundation/feature-flags/feature-flag.assignment.js';

const definition = {
  key: 'new-combat-rules',
  version: 3,
  salt: 'immutable-salt',
  scope: 'CHARACTER' as const,
};

describe('feature flag assignment', () => {
  it('is deterministic for the same immutable flag version and scope', () => {
    const first = featureFlagBucket(definition, 'character-42');
    const second = featureFlagBucket(definition, 'character-42');
    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(10_000);
  });

  it('does not depend on rollout percentage, preventing reshuffles when rollout changes', () => {
    const tenPercent = { ...definition, rolloutPercentage: 10 };
    const ninetyPercent = { ...definition, rolloutPercentage: 90 };
    expect(featureFlagBucket(tenPercent, 'character-42')).toBe(
      featureFlagBucket(ninetyPercent, 'character-42'),
    );
  });

  it('uses an independent deterministic bucket for variant distribution', () => {
    const rolloutBucket = featureFlagBucket(definition, 'character-42');
    const firstVariantBucket = featureFlagVariantBucket(definition, 'character-42');
    const secondVariantBucket = featureFlagVariantBucket(definition, 'character-42');
    expect(firstVariantBucket).toBe(secondVariantBucket);
    expect(firstVariantBucket).toBeGreaterThanOrEqual(0);
    expect(firstVariantBucket).toBeLessThan(10_000);
    expect(firstVariantBucket).not.toBe(rolloutBucket);
  });

  it('selects weighted variants across the full variant bucket', () => {
    const variants = [
      { key: 'control-plus', weight: 1 },
      { key: 'candidate', weight: 3 },
    ];
    expect(selectFeatureFlagVariant(variants, 0)).toBe('control-plus');
    expect(selectFeatureFlagVariant(variants, 9_999)).toBe('candidate');
  });
});
