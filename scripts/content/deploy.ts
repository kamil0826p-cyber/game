import 'dotenv/config';
import { spawn } from 'node:child_process';
import { Pool } from 'pg';
import {
  acquireContentDeploymentLock,
  beginContentPatch,
  completeContentPatch,
  ensureContentPatchRegistry,
  failContentPatch,
  getContentPatch,
  releaseContentDeploymentLock,
} from '../../src/content/content-patch-registry.js';
import { compileContentSnapshot } from '../../src/content/content-validator.js';
import { loadDeployedContentSnapshot } from '../../src/content/deployed-content.repository.js';
import { calculateLegacyContentHash, CONTENT_PATCH_ID } from './content-sources.js';

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL or DIRECT_URL is required for content deployment.');

const runRawSeed = async (): Promise<void> => {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, ['run', 'prisma:seed:raw'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Raw seed failed with code ${String(code)} and signal ${String(signal)}.`));
    });
  });
};

const main = async (): Promise<void> => {
  const pool = new Pool({ connectionString, max: 2 });
  const client = await pool.connect();
  let locked = false;
  const hash = await calculateLegacyContentHash();

  try {
    await acquireContentDeploymentLock(client);
    locked = true;
    await ensureContentPatchRegistry(client);
    const existing = await getContentPatch(client, CONTENT_PATCH_ID);

    if (existing?.status === 'APPLIED') {
      if (existing.hash !== hash) {
        throw new Error(
          `Content patch ${CONTENT_PATCH_ID} changed after it was applied. Create a new patch ID instead of mutating history.`,
        );
      }
      const compiled = compileContentSnapshot(await loadDeployedContentSnapshot(client));
      console.log(`Content is current (${CONTENT_PATCH_ID}, deployed hash ${compiled.hash}).`);
      return;
    }
    if (existing?.status === 'RUNNING') {
      throw new Error(
        `Content patch ${CONTENT_PATCH_ID} is marked RUNNING. Resolve the interrupted deployment before retrying.`,
      );
    }
    if (existing && existing.hash !== hash) {
      throw new Error(
        `Content patch ${CONTENT_PATCH_ID} has a recorded hash different from the current source. Create a new patch ID.`,
      );
    }

    await beginContentPatch(client, CONTENT_PATCH_ID, hash);
    try {
      await runRawSeed();
      const compiled = compileContentSnapshot(await loadDeployedContentSnapshot(client));
      await completeContentPatch(client, CONTENT_PATCH_ID, hash);
      console.log(`Applied ${CONTENT_PATCH_ID}; deployed content hash ${compiled.hash}.`);
    } catch (error) {
      await failContentPatch(client, CONTENT_PATCH_ID, hash, error);
      throw error;
    }
  } finally {
    if (locked) await releaseContentDeploymentLock(client);
    client.release();
    await pool.end();
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
