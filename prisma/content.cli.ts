import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { compileCurrentContent, diffContent, stableStringify } from '../src/content/content-package.compiler.js';
import { deployCompiledContent, readActiveContentRelease, rollbackContent } from '../src/content/content-deployment.service.js';

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value: string) => value.startsWith(prefix))?.slice(prefix.length);
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);
const compile = () => compileCurrentContent({ realmSlug: process.env.GAME_REALM_SLUG ?? 'world-1', realmName: process.env.GAME_REALM_NAME ?? 'World 1' });

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command) throw new Error('Expected compile, validate, dry-run, deploy or rollback.');
  const content = await compile();
  if (command === 'validate') { console.log(`Content ${content.manifest.version} is valid (${content.sourceHash}).`); return; }
  if (command === 'compile') {
    const output = resolve(argument('output') ?? `artifacts/content/${content.manifest.version}.json`);
    await mkdir(dirname(output), { recursive: true }); await writeFile(output, `${stableStringify(content)}\n`, 'utf8');
    console.log(`Compiled content ${content.manifest.version} to ${output}.`); return;
  }
  const connectionString = process.env.DATABASE_URL; if (!connectionString) throw new Error('DATABASE_URL is required.');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    if (command === 'dry-run') { const active = await readActiveContentRelease(prisma); console.log(JSON.stringify(diffContent(active?.manifest ?? null, content.manifest), null, 2)); return; }
    const options = { operationId: argument('operation-id') ?? `${command}:${randomUUID()}`, author: argument('author') ?? process.env.USER ?? 'content-cli', allowRisky: flag('allow-risky') };
    if (command === 'deploy') { const result = await deployCompiledContent(prisma, content, options); console.log(JSON.stringify({ version: result.release.version, hash: result.release.sourceHash, idempotent: result.idempotent, diff: result.diff }, null, 2)); return; }
    if (command === 'rollback') { const version = process.argv[3]; if (!version || version.startsWith('--')) throw new Error('Rollback requires a content version.'); const result = await rollbackContent(prisma, version, options); console.log(JSON.stringify({ version: result.release.version, idempotent: result.idempotent, diff: result.diff }, null, 2)); return; }
    throw new Error(`Unknown content command ${command}.`);
  } finally { await prisma.$disconnect(); }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
