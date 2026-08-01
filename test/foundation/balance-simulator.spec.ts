import { describe, expect, it } from 'vitest';
import {
  createDefaultBalanceScenario,
  simulateBalance,
} from '../../src/foundation/simulation/balance-simulator.js';

describe('balance simulator', () => {
  it('produces byte-for-byte deterministic reports for the same seed', () => {
    const scenario = { ...createDefaultBalanceScenario(3), iterations: 3, maximumActions: 1_000 };
    const first = simulateBalance(scenario, 'fixed-seed');
    const second = simulateBalance(scenario, 'fixed-seed');
    expect(second).toEqual(first);
  });

  it('runs the production 10-person team limit without a separate rules path', () => {
    const scenario = { ...createDefaultBalanceScenario(10), iterations: 1, maximumActions: 2_000 };
    const report = simulateBalance(scenario, 'ten-person-seed');
    expect(report.teamSizeA).toBe(10);
    expect(report.teamSizeB).toBe(10);
    expect(report.runs).toHaveLength(1);
    expect(report.runs[0]!.actions).toBeGreaterThan(0);
  });
});
