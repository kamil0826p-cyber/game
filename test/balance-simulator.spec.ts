import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { runBalanceSimulation, type SimulationScenario } from '../src/simulation/balance-simulator.js';

function scenario(size: number): SimulationScenario {
  return {
    key: `test-${size}v${size}`,
    runs: 20,
    seed: 12345,
    maximumTurns: 200,
    teamA: { size, fighter: { key: 'warrior', characterClass: 'WARRIOR', level: 8, hp: 220, energy: 90, strength: 29, agility: 15, intelligence: 5, armor: 19 } },
    teamB: { size, fighter: { key: 'mage', characterClass: 'MAGE', level: 8, hp: 160, energy: 170, strength: 5, agility: 17, intelligence: 32, armor: 8 } },
  };
}

describe('deterministic balance simulator', () => {
  it('returns identical reports for the same seed', () => {
    expect(runBalanceSimulation(scenario(3))).toEqual(runBalanceSimulation(scenario(3)));
  });

  it('supports party sizes 1 through 10 without timing out the test', () => {
    for (let size = 1; size <= 10; size += 1) {
      const report = runBalanceSimulation({ ...scenario(size), runs: 2 });
      expect(report.runs).toBe(2);
      expect(report.teamAWins + report.teamBWins + report.draws).toBe(2);
    }
  });

  it('has no database or reward persistence dependency', async () => {
    const source = await readFile(new URL('../src/simulation/balance-simulator.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/Prisma|database|RewardService|DomainEventService/);
  });
});
