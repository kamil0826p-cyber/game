import type { PoolClient } from 'pg';

export type ContentPatchStatus = 'RUNNING' | 'APPLIED' | 'FAILED';

export interface ContentPatchRecord {
  id: string;
  hash: string;
  status: ContentPatchStatus;
  startedAt: Date;
  appliedAt: Date | null;
  error: string | null;
}

const CONTENT_DEPLOY_LOCK = 'elderglen-content-deploy';

export const ensureContentPatchRegistry = async (client: PoolClient): Promise<void> => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "ContentPatchRegistry" (
      "id" varchar(160) PRIMARY KEY,
      "hash" char(64) NOT NULL,
      "status" varchar(16) NOT NULL CHECK ("status" IN ('RUNNING', 'APPLIED', 'FAILED')),
      "startedAt" timestamptz NOT NULL DEFAULT now(),
      "appliedAt" timestamptz,
      "error" text
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS "ContentPatchRegistry_status_idx"
    ON "ContentPatchRegistry" ("status", "startedAt")
  `);
};

export const acquireContentDeploymentLock = async (client: PoolClient): Promise<void> => {
  await client.query('SELECT pg_advisory_lock(hashtext($1))', [CONTENT_DEPLOY_LOCK]);
};

export const releaseContentDeploymentLock = async (client: PoolClient): Promise<void> => {
  await client.query('SELECT pg_advisory_unlock(hashtext($1))', [CONTENT_DEPLOY_LOCK]);
};

export const getContentPatch = async (
  client: PoolClient,
  id: string,
): Promise<ContentPatchRecord | undefined> => {
  const result = await client.query<ContentPatchRecord>(`
    SELECT id, hash, status, "startedAt", "appliedAt", error
    FROM "ContentPatchRegistry"
    WHERE id = $1
  `, [id]);
  return result.rows[0];
};

export const beginContentPatch = async (
  client: PoolClient,
  id: string,
  hash: string,
): Promise<void> => {
  await client.query(`
    INSERT INTO "ContentPatchRegistry" (id, hash, status, "startedAt", "appliedAt", error)
    VALUES ($1, $2, 'RUNNING', now(), NULL, NULL)
    ON CONFLICT (id) DO UPDATE SET
      hash = EXCLUDED.hash,
      status = 'RUNNING',
      "startedAt" = now(),
      "appliedAt" = NULL,
      error = NULL
  `, [id, hash]);
};

export const completeContentPatch = async (
  client: PoolClient,
  id: string,
  hash: string,
): Promise<void> => {
  const result = await client.query(`
    UPDATE "ContentPatchRegistry"
    SET status = 'APPLIED', "appliedAt" = now(), error = NULL
    WHERE id = $1 AND hash = $2 AND status = 'RUNNING'
  `, [id, hash]);
  if (result.rowCount !== 1) {
    throw new Error(`Content patch ${id} could not be marked as applied.`);
  }
};

export const failContentPatch = async (
  client: PoolClient,
  id: string,
  hash: string,
  error: unknown,
): Promise<void> => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  await client.query(`
    UPDATE "ContentPatchRegistry"
    SET status = 'FAILED', "appliedAt" = NULL, error = $3
    WHERE id = $1 AND hash = $2
  `, [id, hash, message.slice(0, 16_000)]);
};
