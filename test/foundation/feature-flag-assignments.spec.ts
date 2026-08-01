import { describe, expect, it } from 'vitest';
import {
  selectFeatureVariant,
  stableFeatureBucket,
  validateFeatureVariants,
} from '../../src/foundation/flags/feature-flag.assignments.js';

describe('feature flag assignments', () => {
  it('keeps the same bucket for the same versioned subject', () => {
    const identity = 'salt:feature:3:ACCOUNT:account-1:rollout';
    expect(stableFeatureBucket(identity)).toBe(stableFeatureBucket(identity));
    expect(stableFeatureBucket(identity)).toBeGreaterThanOrEqual(0);
    expect(stableFeatureBucket(identity)).toBeLessThan(10_000);
  });

  it('uses deterministic weighted variants', () => {
    const variants = validateFeatureVariants([
      { key: 'control', weight: 5_000 },
      { key: 'candidate', weight: 5_000 },
    ]);
    expect(selectFeatureVariant(variants, 0)).toBe('control');
    expect(selectFeatureVariant(variants, 4_999)).toBe('control');
    expect(selectFeatureVariant(variants, 5_000)).toBe('candidate');
    expect(selectFeatureVariant(variants, 9_999)).toBe('candidate');
  });

  it('rejects incomplete weights', () => {
    expect(() =>
      validateFeatureVariants([
        { key: 'control', weight: 4_000 },
        { key: 'candidate', weight: 4_000 },
      ]),
    ).toThrow(/sum to 10000/);
  });
});
