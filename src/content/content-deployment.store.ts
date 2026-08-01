import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import {
  emptyContentDiff,
  stableStringify,
  type CompiledContentManifest,
  type ContentDiff,
  type ContentDiffEntry,
} from './content-package.compiler.js';

export const CONTENT_LOCK_KEY = 0x454c444552474c45n;
export type SqlClient = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;

export interface ContentReleaseRecord {
  id: string;
  version: string;
  schemaVersion: number;
  sourceHash: string;
  operationId: string;
  state: 'STAGED' | 'ACTIVE' | 'ROLLED_BACK' | 'FAILED';
  manifest: CompiledContentManifest;
  diff: ContentDiff;
  author: string | null;
  error: string | null;
  createdAt: Date;
  activatedAt: Date | null;
  rolledBackAt: Date | null;
}
export interface ContentDeploymentResult { release: ContentReleaseRecord; diff: ContentDiff; idempotent: boolean; }
export interface ContentDeploymentOptions {
  operationId?: string;
  author?: string;
  allowRisky?: boolean;
  beforeActivate?: (tx: Prisma.TransactionClient, release: ContentReleaseRecord | null) => Promise<void>;
}
interface RawContentRelease extends Omit<ContentReleaseRecord, 'manifest' | 'diff'> { manifest: Prisma.JsonValue; diff: Prisma.JsonValue; }
export interface ContentAttemptRecord {
  operationId: string;
  action: 'DEPLOY' | 'ROLLBACK';
  version: string;
  sourceHash: string;
  state: 'STARTED' | 'SUCCEEDED' | 'IDEMPOTENT' | 'FAILED';
  diff: Prisma.JsonValue;
  error: string | null;
}
function toRelease(record: RawContentRelease): ContentReleaseRecord { return { ...record, manifest: record.manifest as unknown as CompiledContentManifest, diff: record.diff as unknown as ContentDiff }; }
export async function acquireContentLock(tx: SqlClient): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ locked: boolean }>>(Prisma.sql`
    SELECT TRUE AS "locked"
    FROM (SELECT pg_advisory_xact_lock(${CONTENT_LOCK_KEY})) AS acquired
  `);
  if (rows[0]?.locked !== true) throw new Error('Content deployment advisory lock could not be acquired.');
}
async function findRelease(client: SqlClient, predicate: Prisma.Sql): Promise<ContentReleaseRecord | null> {
  const rows = await client.$queryRaw<RawContentRelease[]>(Prisma.sql`
    SELECT "id", "version", "schemaVersion", "sourceHash", "operationId", "state",
      "manifest", "diff", "author", "error", "createdAt", "activatedAt", "rolledBackAt"
    FROM "ContentRelease" WHERE ${predicate}
    ORDER BY "activatedAt" DESC NULLS LAST, "createdAt" DESC LIMIT 1
  `);
  return rows[0] ? toRelease(rows[0]) : null;
}
export function readActiveContentRelease(client: SqlClient): Promise<ContentReleaseRecord | null> { return findRelease(client, Prisma.sql`"state" = 'ACTIVE'`); }
export function readContentReleaseByVersion(client: SqlClient, version: string): Promise<ContentReleaseRecord | null> { return findRelease(client, Prisma.sql`"version" = ${version}`); }
export async function readAttempt(client: SqlClient, operationId: string): Promise<ContentAttemptRecord | null> {
  const rows = await client.$queryRaw<ContentAttemptRecord[]>(Prisma.sql`
    SELECT "operationId", "action", "version", "sourceHash", "state", "diff", "error"
    FROM "ContentDeploymentAttempt" WHERE "operationId" = ${operationId} LIMIT 1
  `);
  return rows[0] ?? null;
}
export async function beginAttempt(client: SqlClient, input: { operationId: string; action: 'DEPLOY' | 'ROLLBACK'; version: string; sourceHash: string; author?: string }): Promise<ContentAttemptRecord> {
  const rows = await client.$queryRaw<ContentAttemptRecord[]>(Prisma.sql`
    INSERT INTO "ContentDeploymentAttempt" ("operationId", "action", "version", "sourceHash", "state", "diff", "author", "startedAt")
    VALUES (${input.operationId}, ${input.action}, ${input.version}, ${input.sourceHash}, 'STARTED', ${stableStringify(emptyContentDiff())}::jsonb, ${input.author ?? null}, NOW())
    ON CONFLICT ("operationId") DO NOTHING
    RETURNING "operationId", "action", "version", "sourceHash", "state", "diff", "error"
  `);
  const attempt = rows[0] ?? await readAttempt(client, input.operationId);
  if (!attempt) throw new Error(`Content operation ${input.operationId} could not be started.`);
  if (attempt.action !== input.action || attempt.version !== input.version || attempt.sourceHash !== input.sourceHash) throw new Error(`Content operation ID ${input.operationId} was already used for another payload.`);
  return attempt;
}
export async function finishAttempt(client: SqlClient, operationId: string, state: 'SUCCEEDED' | 'IDEMPOTENT' | 'FAILED', diff: ContentDiff, error?: string): Promise<void> {
  await client.$executeRaw(Prisma.sql`
    UPDATE "ContentDeploymentAttempt" SET "state" = ${state}, "diff" = ${stableStringify(diff)}::jsonb,
      "error" = ${error ?? null}, "finishedAt" = NOW() WHERE "operationId" = ${operationId}
  `);
}
export async function writePatches(tx: SqlClient, releaseId: string, entries: readonly ContentDiffEntry[]): Promise<void> {
  await tx.$executeRaw(Prisma.sql`DELETE FROM "ContentPatch" WHERE "releaseId" = ${releaseId}::uuid`);
  for (const entry of entries) await tx.$executeRaw(Prisma.sql`
    INSERT INTO "ContentPatch" ("id", "releaseId", "entityKey", "changeType", "beforeHash", "afterHash", "risky", "riskReason", "createdAt")
    VALUES (${randomUUID()}::uuid, ${releaseId}::uuid, ${entry.entityKey}, ${entry.changeType}, ${entry.beforeHash ?? null}, ${entry.afterHash ?? null}, ${entry.risky}, ${entry.riskReason ?? null}, NOW())
  `);
}
