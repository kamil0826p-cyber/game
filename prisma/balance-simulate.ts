import { readFile, writeFile } from 'node:fs/promises';
import {
  compareBalanceReports,
  DEFAULT_BALANCE_SCENARIOS,
  runBalanceScenario,
  type BalanceSimulationReport,
} from '../src/foundation/balance/balance-simulator.js';

const option = (name: string): string | undefined => {
  const prefix = `--${name}=`;
  return process.argv.find((entry) => entry.startsWith(prefix))?.slice(prefix.length);
};

async function main(): Promise<void> {
  const reports = DEFAULT_BALANCE_SCENARIOS.map(runBalanceScenario);
  const output = option('output');
  if (output) await writeFile(output, `${JSON.stringify(reports, null, 2)}\n`, 'utf8');

  const baselinePath = option('baseline');
  if (!baselinePath) {
    console.log(JSON.stringify(reports, null, 2));
    return;
  }

  const baseline = JSON.parse(await readFile(baselinePath, 'utf8')) as BalanceSimulationReport[];
  const baselineByScenario = new Map(baseline.map((report) => [report.scenarioKey, report]));
  const comparisons = reports.map((candidate) => {
    const previous = baselineByScenario.get(candidate.scenarioKey);
    if (!previous) throw new Error(`Baseline is missing scenario ${candidate.scenarioKey}.`);
    return { scenarioKey: candidate.scenarioKey, ...compareBalanceReports(previous, candidate) };
  });
  console.log(JSON.stringify({ reports, comparisons }, null, 2));
  if (comparisons.some((comparison) => !comparison.passed)) process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
