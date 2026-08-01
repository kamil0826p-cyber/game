import type { PrismaClient, Prisma } from '../../generated/prisma/client.js';
import { logicalContentDiff, stableContentHash } from './content.canonical.js';
import { captureContentSnapshot } from './content.snapshot.js';
import type {
  ContentLogicalDiff,
  ContentManifest,
  ContentSnapshotRecord,
} from './content.types.js';

export interface ContentDeploymentResult {
  hash: string;
  created: boolean;
  diff: ContentLogicalDiff;
}

const snapshotRecords = (
  snapshots: readonly { category: string; key: string; payload: Prisma.JsonValue }[],
): ContentSnapshotRecord[] =>
  snapshots.map((snapshot) => ({
    category: snapshot.category as ContentSnapshotRecord['category'],
    key: snapshot.key,
    payload: snapshot.payload,
  }));

export async function deployContentPackage(
  prisma: PrismaClient,
  sourceManifest: ContentManifest,
): Promise<ContentDeploymentResult> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtext('game-content-deployment'))
    `;
    const nextSnapshot = await captureContentSnapshot(transaction, sourceManifest);
    const hash = stableContentHash({
      schemaVersion: sourceManifest.schemaVersion,
      records: nextSnapshot,
    });
    const existing = await transaction.contentVersion.findUnique({
      where: { hash },
      include: { snapshots: true },
    });
    const active = await transaction.activeContentVersion.findUnique({
      where: { id: 'active' },
      include: { contentVersion: { include: { snapshots: true } } },
    });
    const previousSnapshot = active ? snapshotRecords(active.contentVersion.snapshots) : [];
    const diff = logicalContentDiff(previousSnapshot, nextSnapshot);

    if (existing) {
      if (active?.contentVersionId !== existing.id) {
        if (active) {
          await transaction.contentVersion.update({
            where: { id: active.contentVersionId },
            data: { status: 'SUPERSEDED' },
          });
        }
        await transaction.contentVersion.update({
          where: { id: existing.id },
          data: { status: 'ACTIVE', activatedAt: new Date(), rolledBackAt: null },
        });
        await transaction.activeContentVersion.upsert({
          where: { id: 'active' },
          create: { id: 'active', contentVersionId: existing.id },
          update: { contentVersionId: existing.id },
        });
      }
      await Promise.all([
        transaction.inventoryItem.updateMany({
          where: { definitionVersionHash: null },
          data: { definitionVersionHash: hash },
        }),
        transaction.characterQuest.updateMany({
          where: { definitionVersionHash: null },
          data: { definitionVersionHash: hash },
        }),
      ]);
      return { hash, created: false, diff };
    }

    const created = await transaction.contentVersion.create({
      data: {
        hash,
        schemaVersion: sourceManifest.schemaVersion,
        status: 'ACTIVE',
        manifest: sourceManifest as unknown as Prisma.InputJsonValue,
        logicalDiff: diff as unknown as Prisma.InputJsonValue,
        activatedAt: new Date(),
        snapshots: {
          create: nextSnapshot.map((record) => ({
            category: record.category,
            key: record.key,
            payload: record.payload as Prisma.InputJsonValue,
            payloadHash: stableContentHash(record.payload),
          })),
        },
      },
    });

    if (active) {
      await transaction.contentVersion.update({
        where: { id: active.contentVersionId },
        data: { status: 'SUPERSEDED' },
      });
    }
    await transaction.activeContentVersion.upsert({
      where: { id: 'active' },
      create: { id: 'active', contentVersionId: created.id },
      update: { contentVersionId: created.id },
    });
    await Promise.all([
      transaction.inventoryItem.updateMany({
        where: { definitionVersionHash: null },
        data: { definitionVersionHash: hash },
      }),
      transaction.characterQuest.updateMany({
        where: { definitionVersionHash: null },
        data: { definitionVersionHash: hash },
      }),
    ]);

    return { hash, created: true, diff };
  });
}
