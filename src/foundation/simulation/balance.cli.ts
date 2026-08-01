import { readFile } from 'node:fs/promises';
import {
  compareBalanceReports,
  createDefaultBalanceScenario,
  simulateBalance,
  type BalanceScenario,
} from './balance-simulator.js';

async function readScenario(path: string | undefined): Promise<BalanceScenario | undefined> {
  if (!path) return undefined;
  return JSON.parse(await readFile(path, 'utf8')) as BalanceScenario;
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'suite';
  const seed = process.env.BALANCE_SEED ?? 'production-baseline-v1';
  if (command === 'suite') {
    const reports = ([1, 3, 5, 10] as const).map((teamSize) =>
      simulateBalance(createDefaultBalanceScenario(teamSize), `${seed}:${teamSize}`),
    );
    console.log(JSON.stringify({ seed, reports }, null, 2));
    return;
  }
  if (command === 'run') {
    const scenario = await readScenario(process.argv[3]);
    if (!scenario) throw new Error('Usage: balance.cli.ts run <scenario.json>');
    console.log(JSON.stringify(simulateBalance(scenario, seed), null, 2));
    return;
  }
  if (command === 'compare') {
    const baselineScenario = await readScenario(process.argv[3]);
    const candidateScenario = await readScenario(process.argv[4]);
    if (!baselineScenario || !candidateScenario) {
      throw new Error('Usage: balance.cli.ts compare <baseline.json> <candidate.json>');
    }
    const comparison = compareBalanceReports(
      simulateBalance(baselineScenario, seed),
      simulateBalance(candidateScenario, seed),
      {
        maximumTtkIncreasePercent: Number(process.env.BALANCE_MAX_TTK_REGRESSION_PERCENT ?? 10),
        maximumWinRateDeltaPercentagePoints: Number(process.env.BALANCE_MAX_WIN_RATE_DELTA_PP ?? 7.5),
        maximumTimeoutRateIncreasePercentagePoints: Number(process.env.BALANCE_MAX_TIMEOUT_DELTA_PP ?? 2),
      },
    );
    console.log(JSON.stringify(comparison, null, 2));
    if (!comparison.passed) process.exitCode = 2;
    return;
  }
  throw new Error(`Unknown balance command ${command}.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
