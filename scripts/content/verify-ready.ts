import 'dotenv/config';
import { Pool } from 'pg';
import { compileContentPackage } from '../../src/content/content-package.js';
import { loadDeployedContentSnapshot } from '../../src/content/deployed-content.repository.js';
import { calculateLegacyContentHash, CONTENT_PATCH_ID } from './content-sources.js';

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL or DIRECT_URL is required for readiness verification.');

const main = async (): Promise<void> => {
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    const registry = await client.query<{ exists: boolean }>(
      `SELECT to_regclass('public."ContentPatchRegistry"') IS NOT NULL AS exists`,
    );
    if (!registry.rows[0]?.exists) {
      throw new Error('ContentPatchRegistry is missing. Run npm run deploy:prepare before starting the server.');
    }

    const patch = await client.query<{ hash: string; status: string }>(`
      SELECT hash, status
      FROM "ContentPatchRegistry"
      WHERE id = $1
    `, [CONTENT_PATCH_ID]);
    const record = patch.rows[0];
    if (!record || record.status !== 'APPLIED') {
      throw new Error(`Required content patch ${CONTENT_PATCH_ID} is not applied.`);
    }

    const expectedHash = await calculateLegacyContentHash();
    if (record.hash !== expectedHash) {
      throw new Error(
        `Applied content patch ${CONTENT_PATCH_ID} does not match the current source. Deploy a new versioned patch.`,
      );
    }

    const compiled = compileContentPackage(await loadDeployedContentSnapshot(client));
    console.log(`Content readiness passed (${CONTENT_PATCH_ID}, deployed hash ${compiled.hash}).`);
  } finally {
    client.release();
    await pool.end();
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
