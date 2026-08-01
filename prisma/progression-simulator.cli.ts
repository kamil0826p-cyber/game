import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { simulateRepresentativeProgression } from '../src/simulation/progression-simulator.js';

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function integers(name: string, fallback: number[]): number[] {
  const raw = argument(name);
  if (!raw) return fallback;
  const values = raw.split(',').map(Number);
  if (values.some((value) => !Number.isInteger(value))) throw new Error(`--${name} must be comma-separated integers.`);
  return values;
}

async function main(): Promise<void> {
  const runs = Number(argument('runs') ?? 100);
  const seed = Number(argument('seed') ?? 20260801);
  if (!Number.isInteger(runs) || runs < 1 || runs > 100_000) throw new Error('--runs must be 1-100000.');
  if (!Number.isInteger(seed)) throw new Error('--seed must be an integer.');
  const report = simulateRepresentativeProgression({
    runs,
    seed,
    levels: integers('levels', [1, 10, 25, 50, 75, 100]),
    teamSizes: integers('team-sizes', [1, 3, 5, 10]),
  });
  const failed = report.filter((entry) => !entry.controlled);
  const output = `${JSON.stringify({ generatedAt: new Date().toISOString(), controlled: failed.length === 0, failed, report }, null, 2)}\n`;
  const path = argument('output');
  if (path) await writeFile(resolve(path), output, 'utf8');
  else process.stdout.write(output);
  if (failed.length > 0) process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
