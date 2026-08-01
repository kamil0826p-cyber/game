import { describe, expect, it } from 'vitest';
import {
  compareBalanceReports,
  runBalanceScenario,
} from '../../src/foundation/balance/balance-simulator.js';

describe('deterministic production combat simulator', () => {
  it('returns identical output for an identical seed', () => {
    const scenario = {
      key: 'determinism',
      seed: 42,
      teamA: { size: 3 as const, characterClass: 'MAGE' as const, level: 40 },
      teamB: { size: 3 as const, characterClass: 'WARRIOR' as const, level: 40 },
    };
    expect(runBalanceScenario(scenario)).toEqual(runBalanceScenario(scenario));
  });

  it('runs a full 10 versus 10 scenario through CombatEngine without a special path', () => {
    const result = runBalanceScenario({
      key: 'ten-versus-ten',
      seed: 1010,
      teamA: { size: 10, characterClass: 'ARCHER', level: 60 },
      teamB: { size: 10, characterClass: 'WARRIOR', level: 60 },
    });
    expect(result.turns).toBeGreaterThan(0);
    expect(result.survivors.teamA + result.survivors.teamB).toBeLessThanOrEqual(20);
    expect(result.composition).toEqual({
      teamA: { size: 10, characterClass: 'ARCHER', level: 60 },
      teamB: { size: 10, characterClass: 'WARRIOR', level: 60 },
    });
    expect(['TEAM_A', 'TEAM_B', 'DRAW']).toContain(result.winner);
  });

  it('reports candidate regressions against explicit thresholds', () => {
    const baseline = runBalanceScenario({
      key: 'baseline',
      seed: 7,
      teamA: { size: 1, characterClass: 'WARRIOR', level: 30 },
      teamB: { size: 1, characterClass: 'WARRIOR', level: 30 },
    });
    const candidate = { ...baseline, ttkTurns: (baseline.ttkTurns ?? 10) * 2 };
    expect(compareBalanceReports(baseline, candidate, { ttkRatio: 0.1 }).passed).toBe(false);
  });
});
