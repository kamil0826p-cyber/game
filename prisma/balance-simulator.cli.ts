import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  compareBalanceSimulations,
  runBalanceSimulation,
  type SimulationScenario,
} from '../src/simulation/balance-simulator.js';

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function readScenario(path: string): Promise<SimulationScenario> {
  return JSON.parse(await readFile(resolve(path), 'utf8')) as SimulationScenario;
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'run';
  const input = argument('input') ?? 'prisma/balance.example.json';
  const output = argument('output');
  let report: unknown;
  if (command === 'run') {
    report = runBalanceSimulation(await readScenario(input));
  } else if (command === 'compare') {
    const candidate = argument('candidate');
    if (!candidate) throw new Error('compare requires --candidate=<scenario.json>.');
    report = compareBalanceSimulations(await readScenario(input), await readScenario(candidate));
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
