import { describe, expect, it } from 'vitest';
import { selectExperimentVariant } from '../src/analytics/analytics-experiment.service.js';

const definition = {
  key: 'new-onboarding',
  version: 2,
  rolloutBasisPoints: 10_000,
  salt: 'stable-test-salt',
  variants: [
    { key: 'control', weight: 5000 },
    { key: 'guided', weight: 5000 },
  ],
};

describe('analytics experiment assignment', () => {
  it('is stable for the same version and subject', () => {
    const assigned = selectExperimentVariant(definition, '00000000-0000-0000-0000-000000000001');
    expect(selectExperimentVariant(definition, '00000000-0000-0000-0000-000000000001')).toBe(assigned);
  });

  it('returns control outside rollout', () => {
    expect(selectExperimentVariant({ ...definition, rolloutBasisPoints: 0 }, 'subject')).toBe('control');
  });

  it('rejects invalid weights before assigning players', () => {
    expect(() => selectExperimentVariant({ ...definition, variants: [{ key: 'bad', weight: 9999 }] }, 'subject'))
      .toThrow('total 10000');
  });
});
