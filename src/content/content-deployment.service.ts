import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { diffContent, emptyContentDiff, stableStringify, validateCompiledManifest, type CompiledContentPackage, type ContentDiff } from './content-package.compiler.js';
import { applyManifest } from './content-manifest.applier.js';
import { acquireContentLock, beginAttempt, finishAttempt, readActiveContentRelease, readContentReleaseByVersion, writePatches, type ContentDeploymentOptions, type ContentDeploymentResult, type ContentReleaseRecord } from './content-deployment.store.js';

export type { ContentDeploymentOptions, ContentDeploymentResult, ContentReleaseRecord } from './content-deployment.store.js';
export { readActiveContentRelease, readContentReleaseByVersion } from './content-deployment.store.js';

@Injectable()
export class ContentDeploymentService {
  constructor(private readonly prisma: PrismaService) {}
  active(): Promise<ContentReleaseRecord | null> { return readActiveContentRelease(this.prisma); }
  dryRun(compiled: CompiledContentPackage): Promise<ContentDiff> { validateCompiledManifest(compiled.manifest); return this.active().then((active) => diffContent(active?.manifest ?? null, compiled.manifest)); }
  deploy(compiled: CompiledContentPackage, options: ContentDeploymentOptions = {}): Promise<ContentDeploymentResult> { return deployCompiledContent(this.prisma, compiled, options); }
  rollback(version: string, options: ContentDeploymentOptions = {}): Promise<ContentDeploymentResult> { return rollbackContent(this.prisma, version, options); }
}

export async function deployCompiledContent(prisma: PrismaClient, compiled: CompiledContentPackage, options: ContentDeploymentOptions = {}): Promise<ContentDeploymentResult> {
  validateCompiledManifest(compiled.manifest);
  const operationId = options.operationId ?? `content-deploy:${compiled.manifest.version}:${randomUUID()}`;
  const releaseId = randomUUID();
  await beginAttempt(prisma, { operationId, action: 'DEPLOY', version: compiled.manifest.version, sourceHash: compiled.sourceHash, author: options.author });
  try {
    return await prisma.$transaction(async (tx) => {
      await acquireContentLock(tx);
      const active = await readActiveContentRelease(tx);
      const existing = await readContentReleaseByVersion(tx, compiled.manifest.version);
      if (existing?.sourceHash && existing.sourceHash !== compiled.sourceHash) throw new Error(`Content version ${compiled.manifest.version} already exists with a different source hash.`);
      if (existing?.state === 'ACTIVE' && existing.sourceHash === compiled.sourceHash) { await finishAttempt(tx, operationId, 'IDEMPOTENT', existing.diff); return { release: existing, diff: existing.diff, idempotent: true }; }
      const diff = diffContent(active?.manifest ?? null, compiled.manifest);
      if (active && diff.risky.length && !options.allowRisky) throw new Error(`Risky content changes require --allow-risky: ${diff.risky.join(', ')}.`);
      const targetId = existing?.id ?? releaseId;
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "ContentRelease" ("id", "version", "schemaVersion", "sourceHash", "operationId", "state", "manifest", "diff", "author", "createdAt")
        VALUES (${targetId}::uuid, ${compiled.manifest.version}, ${compiled.manifest.schemaVersion}, ${compiled.sourceHash}, ${operationId}, 'STAGED', ${stableStringify(compiled.manifest)}::jsonb, ${stableStringify(diff)}::jsonb, ${options.author ?? null}, NOW())
        ON CONFLICT ("version") DO UPDATE SET "schemaVersion" = EXCLUDED."schemaVersion", "sourceHash" = EXCLUDED."sourceHash", "operationId" = EXCLUDED."operationId", "state" = 'STAGED', "manifest" = EXCLUDED."manifest", "diff" = EXCLUDED."diff", "author" = EXCLUDED."author", "error" = NULL, "activatedAt" = NULL, "rolledBackAt" = NULL
      `);
      await applyManifest(tx, compiled.manifest);
      await options.beforeActivate?.(tx, active);
      await writePatches(tx, targetId, diff.entries);
      await tx.$executeRaw(Prisma.sql`UPDATE "ContentRelease" SET "state" = 'ROLLED_BACK', "rolledBackAt" = NOW() WHERE "state" = 'ACTIVE' AND "version" <> ${compiled.manifest.version}`);
      await tx.$executeRaw(Prisma.sql`UPDATE "ContentRelease" SET "state" = 'ACTIVE', "activatedAt" = NOW(), "rolledBackAt" = NULL, "error" = NULL WHERE "version" = ${compiled.manifest.version}`);
      const release = await readContentReleaseByVersion(tx, compiled.manifest.version); if (!release) throw new Error('Activated content release could not be read back.');
      await finishAttempt(tx, operationId, 'SUCCEEDED', diff);
      return { release, diff, idempotent: false };
    }, { isolationLevel: 'ReadCommitted', timeout: 60_000, maxWait: 10_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishAttempt(prisma, operationId, 'FAILED', emptyContentDiff(), message).catch(() => undefined);
    throw error;
  }
}

export async function rollbackContent(prisma: PrismaClient, version: string, options: ContentDeploymentOptions = {}): Promise<ContentDeploymentResult> {
  const targetBeforeLock = await readContentReleaseByVersion(prisma, version);
  if (!targetBeforeLock || targetBeforeLock.state === 'FAILED') throw new Error(`Content release ${version} is unavailable.`);
  const operationId = options.operationId ?? `content-rollback:${version}:${randomUUID()}`;
  await beginAttempt(prisma, { operationId, action: 'ROLLBACK', version, sourceHash: targetBeforeLock.sourceHash, author: options.author });
  try {
    return await prisma.$transaction(async (tx) => {
      await acquireContentLock(tx);
      const active = await readActiveContentRelease(tx);
      const target = await readContentReleaseByVersion(tx, version);
      if (!target || target.state === 'FAILED') throw new Error(`Content release ${version} is unavailable.`);
      validateCompiledManifest(target.manifest);
      if (active?.version === version) { await finishAttempt(tx, operationId, 'IDEMPOTENT', target.diff); return { release: target, diff: target.diff, idempotent: true }; }
      const diff = diffContent(active?.manifest ?? null, target.manifest);
      if (diff.risky.length && !options.allowRisky) throw new Error(`Risky rollback requires --allow-risky: ${diff.risky.join(', ')}.`);
      await applyManifest(tx, target.manifest);
      await options.beforeActivate?.(tx, active);
      await tx.$executeRaw(Prisma.sql`UPDATE "ContentRelease" SET "state" = 'ROLLED_BACK', "rolledBackAt" = NOW() WHERE "state" = 'ACTIVE'`);
      await tx.$executeRaw(Prisma.sql`UPDATE "ContentRelease" SET "state" = 'ACTIVE', "operationId" = ${operationId}, "author" = ${options.author ?? null}, "activatedAt" = NOW(), "rolledBackAt" = NULL, "error" = NULL, "diff" = ${stableStringify(diff)}::jsonb WHERE "version" = ${version}`);
      const release = await readContentReleaseByVersion(tx, version); if (!release) throw new Error('Rolled back content release could not be read back.');
      await finishAttempt(tx, operationId, 'SUCCEEDED', diff);
      return { release, diff, idempotent: false };
    }, { isolationLevel: 'ReadCommitted', timeout: 60_000, maxWait: 10_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishAttempt(prisma, operationId, 'FAILED', emptyContentDiff(), message).catch(() => undefined);
    throw error;
  }
}
