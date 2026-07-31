import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  compareBalanceSuites,
  runBalanceSimulation,
  runBalanceSuite,
  type SimulationFighterProfile,
  type SimulationScenario,
  type SimulationSuite,
} from '../src/simulation/balance-simulator.js';

const warrior: SimulationFighterProfile = {
  key: 'warrior',
  characterClass: 'WARRIOR',
  level: 8,
  hp: 220,
  energy: 90,
  strength: 29,
  agility: 15,
  intelligence: 5,
  armor: 19,
};

const mage: SimulationFighterProfile = {
  key: 'mage',
  characterClass: 'MAGE',
  level: 8,
  hp: 160,
  energy: 170,
  strength: 5,
  agility: 17,
  intelligence: 32,
  armor: 8,
};

const archer: SimulationFighterProfile = {
  key: 'archer',
  characterClass: 'ARCHER',
  level: 8,
  hp: 185,
  energy: 125,
  strength: 10,
  agility: 31,
  intelligence: 8,
  armor: 12,
};

function scenario(size: number): SimulationScenario {
  return {
    key: `test-${size}v${size}`,
    runs: 20,
    seed: 12345,
    maximumTurns: 300,
    teamA: { members: [{ count: size, fighter: warrior }] },
    teamB: { members: [{ count: size, fighter: mage }] },
  };
}

function suite(): SimulationSuite {
  return {
    key: 'test-suite',
    scenarios: [
      scenario(1),
      {
        key: 'mixed-3v3',
        runs: 10,
        seed: 9876,
        maximumTurns: 400,
        teamA: {
          members: [
            { count: 1, fighter: warrior },
            { count: 1, fighter: mage },
            { count: 1, fighter: archer },
          ],
        },
        teamB: {
          members: [
            { count: 2, fighter: warrior },
            { count: 1, fighter: archer },
          ],
        },
      },
      scenario(10),
    ],
  };
}

describe('deterministic balance simulator', () => {
  it('returns identical reports for the same seed including skill effectiveness', () => {
    const first = runBalanceSimulation(scenario(3));
    const second = runBalanceSimulation(scenario(3));
    expect(first).toEqual(second);
    expect(Object.keys(first.skillPerformance).length).toBeGreaterThan(0);
    expect(Object.values(first.skillPerformance).every((value) => value.uses > 0)).toBe(true);
  });

  it('supports party sizes 1 through 10 without timing out the test', () => {
    for (let size = 1; size <= 10; size += 1) {
      const report = runBalanceSimulation({ ...scenario(size), runs: 2 });
      expect(report.runs).toBe(2);
      expect(report.teamASize).toBe(size);
      expect(report.teamBSize).toBe(size);
      expect(report.teamAWins + report.teamBWins + report.draws).toBe(2);
    }
  });

  it('runs and compares solo, mixed and 10-player compositions in one report', () => {
    const baseline = suite();
    const candidate: SimulationSuite = {
      ...baseline,
      key: 'candidate-suite',
      scenarios: baseline.scenarios.map((value) => ({
        ...value,
        teamA: {
          members: value.teamA.members.map((member) => ({
            ...member,
            fighter: { ...member.fighter, hp: member.fighter.hp + 5 },
          })),
        },
      })),
    };
    const report = runBalanceSuite(baseline);
    const comparison = compareBalanceSuites(baseline, candidate);
    expect(report.scenarios.map((value) => value.scenarioKey)).toEqual([
      'test-1v1',
      'mixed-3v3',
      'test-10v10',
    ]);
    expect(report.scenarios[1]?.metrics.teamAComposition).toEqual({ warrior: 1, mage: 1, archer: 1 });
    expect(comparison.scenarios).toHaveLength(3);
    expect(comparison.scenarios.every((value) => Number.isFinite(value.comparison.delta.teamAWinRate))).toBe(true);
  });

  it('has no database or reward persistence dependency', async () => {
    const source = await readFile(new URL('../src/simulation/balance-simulator.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/Prisma|database|RewardService|DomainEventService/);
  });
});
