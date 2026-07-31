import 'dotenv/config';
import { Pool } from 'pg';
import { compileContentPackage } from '../../src/content/content-package.js';
import { ContentValidationError } from '../../src/content/content-validator.js';
import { loadDeployedContentSnapshot } from '../../src/content/deployed-content.repository.js';

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL or DIRECT_URL is required for content validation.');

const main = async (): Promise<void> => {
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    const result = compileContentPackage(await loadDeployedContentSnapshot(client));
    console.log(`Content validation passed. Stable hash: ${result.hash}`);
  } finally {
    client.release();
    await pool.end();
  }
};

main().catch((error: unknown) => {
  if (error instanceof ContentValidationError) {
    console.error('Content validation failed:');
    error.issues.forEach((issue) => console.error(`- ${issue.path}: ${issue.message}`));
  } else {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
  }
  process.exitCode = 1;
});
