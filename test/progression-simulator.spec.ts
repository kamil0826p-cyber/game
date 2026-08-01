import { describe, expect, it } from 'vitest';
import {
  simulateProgressionCase,
  simulateRepresentativeProgression,
} from '../src/simulation/progression-simulator.js';

const scenario = {
  level: 25,
  teamSize: 3,
  attackerClass: 'ARCHER' as const,
  attackerNode: 'PRECISION' as const,
  defenderClass: 'WARRIOR' as const,
  defenderNode: 'ENDURANCE' as const,
  runs: 20,
  seed: 123456,
  maximumActions: 750,
};

describe('progression simulator', () => {
  it('returns identical TTK results for the same seed', () => {
    expect(simulateProgressionCase(scenario)).toEqual(simulateProgressionCase(scenario));
  });

  it('covers representative levels and groups 1-10 without database writes', () => {
    const report = simulateRepresentativeProgression({
      runs: 2,
      levels: [1, 10, 50, 100],
      teamSizes: [1, 3, 10],
      seed: 987,
    });
    expect(report).toHaveLength(24);
    expect(report.every((entry) => entry.teamSize >= 1 && entry.teamSize <= 10)).toBe(true);
    expect(report.every((entry) => entry.averageActions > 0)).toBe(true);
  });
});
