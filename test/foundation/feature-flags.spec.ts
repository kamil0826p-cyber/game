import { describe, expect, it } from 'vitest';
import {
  featureFlagBucket,
  selectFeatureFlagVariant,
} from '../../src/foundation/feature-flags/feature-flag.service.js';

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
    const atTenPercent = featureFlagBucket(tenPercent, 'character-42');
    const atNinetyPercent = featureFlagBucket(ninetyPercent, 'character-42');
    expect(atTenPercent).toBe(atNinetyPercent);
  });

  it('selects weighted variants deterministically', () => {
    const variants = [
      { key: 'control-plus', weight: 1 },
      { key: 'candidate', weight: 3 },
    ];
    expect(selectFeatureFlagVariant(variants, 0)).toBe('control-plus');
    expect(selectFeatureFlagVariant(variants, 9_999)).toBe('candidate');
  });
});
