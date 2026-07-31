import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  compareBalanceSimulations,
  compareBalanceSuites,
  runBalanceSimulation,
  runBalanceSuite,
  type SimulationScenario,
  type SimulationSuite,
} from '../src/simulation/balance-simulator.js';

type SimulationInput = SimulationScenario | SimulationSuite;

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function readInput(path: string): Promise<SimulationInput> {
  return JSON.parse(await readFile(resolve(path), 'utf8')) as SimulationInput;
}

function isSuite(input: SimulationInput): input is SimulationSuite {
  return Array.isArray((input as SimulationSuite).scenarios);
}

function run(input: SimulationInput): unknown {
  return isSuite(input) ? runBalanceSuite(input) : runBalanceSimulation(input);
}

function compare(baseline: SimulationInput, candidate: SimulationInput): unknown {
  if (isSuite(baseline) !== isSuite(candidate)) {
    throw new Error('Baseline and candidate must both be scenarios or both be suites.');
  }
  return isSuite(baseline)
    ? compareBalanceSuites(baseline, candidate as SimulationSuite)
    : compareBalanceSimulations(baseline, candidate as SimulationScenario);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'run';
  const input = argument('input') ?? 'prisma/balance.example.json';
  const output = argument('output');
  let report: unknown;
  if (command === 'run') {
    report = run(await readInput(input));
  } else if (command === 'compare') {
    const candidate = argument('candidate');
    if (!candidate) throw new Error('compare requires --candidate=<scenario-or-suite.json>.');
    report = compare(await readInput(input), await readInput(candidate));
  } else {
    throw new Error('Usage: npm run balance:simulate -- run|compare [--input=file] [--candidate=file] [--output=file]');
  }
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (output) await writeFile(resolve(output), json, 'utf8');
  else process.stdout.write(json);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
