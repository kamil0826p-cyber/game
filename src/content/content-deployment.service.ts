import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  diffContent,
  stableStringify,
  type CompiledContentManifest,
  type CompiledContentPackage,
  type ContentDiff,
} from './content-package.compiler.js';

const CONTENT_LOCK_KEY = 0x454c444552474c45n;

type SqlClient = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;

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

export interface ContentDeploymentResult {
  release: ContentReleaseRecord;
  diff: ContentDiff;
  idempotent: boolean;
}

interface RawContentRelease extends Omit<ContentReleaseRecord, 'manifest' | 'diff'> {
  manifest: Prisma.JsonValue;
  diff: Prisma.JsonValue;
}

function toRelease(record: RawContentRelease): ContentReleaseRecord {
  return {
    ...record,
    manifest: record.manifest as unknown as CompiledContentManifest,
    diff: record.diff as unknown as ContentDiff,
  };
}

async function acquireContentLock(tx: SqlClient): Promise<void> {
  await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(${CONTENT_LOCK_KEY})`);
}

async function findRelease(
  client: SqlClient,
  predicate: Prisma.Sql,
): Promise<ContentReleaseRecord | null> {
  const rows = await client.$queryRaw<RawContentRelease[]>(Prisma.sql`
    SELECT
      "id", "version", "schemaVersion", "sourceHash", "operationId", "state",
      "manifest", "diff", "author", "error", "createdAt", "activatedAt", "rolledBackAt"
    FROM "ContentRelease"
    WHERE ${predicate}
    ORDER BY "activatedAt" DESC NULLS LAST, "createdAt" DESC
    LIMIT 1
  `);
  return rows[0] ? toRelease(rows[0]) : null;
}

export function readActiveContentRelease(client: SqlClient): Promise<ContentReleaseRecord | null> {
  return findRelease(client, Prisma.sql`"state" = 'ACTIVE'`);
}

export function readContentReleaseByVersion(
  client: SqlClient,
  version: string,
): Promise<ContentReleaseRecord | null> {
  return findRelease(client, Prisma.sql`"version" = ${version}`);
}

async function applyManifest(
  tx: Prisma.TransactionClient,
  manifest: CompiledContentManifest,
): Promise<void> {
  const realm = await tx.realm.upsert({
    where: { slug: manifest.realm.slug },
    create: { slug: manifest.realm.slug, name: manifest.realm.name, isActive: true },
    update: { name: manifest.realm.name, isActive: true },
  });

  const mapIds = new Map<string, string>();
  for (const definition of manifest.maps) {
    const existing = await tx.map.findUnique({
      where: { realmId_key: { realmId: realm.id, key: definition.key } },
      select: { version: true },
    });
    const map = await tx.map.upsert({
      where: { realmId_key: { realmId: realm.id, key: definition.key } },
      create: {
        realmId: realm.id,
        key: definition.key,
        name: definition.name,
        width: definition.width,
        height: definition.height,
        zoneType: definition.zoneType,
        spawnX: definition.spawnX,
        spawnY: definition.spawnY,
        tiledData: definition.tiledData as unknown as Prisma.InputJsonValue,
        version: 1,
      },
      update: {
        name: definition.name,
        width: definition.width,
        height: definition.height,
        zoneType: definition.zoneType,
        spawnX: definition.spawnX,
        spawnY: definition.spawnY,
        tiledData: definition.tiledData as unknown as Prisma.InputJsonValue,
        version: (existing?.version ?? 0) + 1,
      },
    });
    mapIds.set(definition.key, map.id);
  }

  for (const definition of manifest.maps) {
    const sourceMapId = mapIds.get(definition.key);
    if (!sourceMapId) throw new Error(`Map ${definition.key} was not deployed.`);
    await tx.portal.deleteMany({ where: { sourceMapId } });
    if (definition.portals.length > 0) {
      await tx.portal.createMany({
        data: definition.portals.map((portal) => {
          const destinationMapId = mapIds.get(portal.destinationMapKey);
          if (!destinationMapId) {
            throw new Error(`Portal on ${definition.key} references ${portal.destinationMapKey}.`);
          }
          return {
            sourceMapId,
            sourceX: portal.sourceX,
            sourceY: portal.sourceY,
            destinationMapId,
            targetX: portal.targetX,
            targetY: portal.targetY,
            enabled: true,
          };
        }),
      });
    }
  }

  for (const item of manifest.items) {
    await tx.itemDefinition.upsert({
      where: { key: item.key },
      create: {
        key: item.key,
        name: item.name,
        description: item.description,
        stackLimit: item.stackLimit,
        metadata: item.metadata as Prisma.InputJsonValue,
      },
      update: {
        name: item.name,
        description: item.description,
        stackLimit: item.stackLimit,
        metadata: item.metadata as Prisma.InputJsonValue,
      },
    });
  }

  for (const quest of manifest.quests) {
    await tx.questDefinition.upsert({
      where: { key: quest.key },
      create: {
        key: quest.key,
        name: quest.name,
        description: quest.description,
        minimumLevel: quest.minimumLevel,
        steps: quest.steps as Prisma.InputJsonValue,
        rewards: quest.rewards as Prisma.InputJsonValue,
      },
      update: {
        name: quest.name,
        description: quest.description,
        minimumLevel: quest.minimumLevel,
        steps: quest.steps as Prisma.InputJsonValue,
        rewards: quest.rewards as Prisma.InputJsonValue,
      },
    });
  }

  const managedMapIds = [...mapIds.values()];
  const expectedNpcKeysByMap = new Map<string, string[]>();
  for (const npc of manifest.npcs) {
    const mapId = mapIds.get(npc.mapKey);
    if (!mapId) throw new Error(`NPC ${npc.key} references missing map ${npc.mapKey}.`);
    const expected = expectedNpcKeysByMap.get(mapId) ?? [];
    expected.push(npc.key);
    expectedNpcKeysByMap.set(mapId, expected);
    await tx.npcDefinition.upsert({
      where: { mapId_key: { mapId, key: npc.key } },
      create: {
        mapId,
        key: npc.key,
        name: npc.name,
        x: npc.x,
        y: npc.y,
        outfitKey: npc.outfitKey,
        dialogue: npc.dialogue as unknown as Prisma.InputJsonValue,
      },
      update: {
        name: npc.name,
        x: npc.x,
        y: npc.y,
        outfitKey: npc.outfitKey,
        dialogue: npc.dialogue as unknown as Prisma.InputJsonValue,
      },
    });
  }
  for (const mapId of managedMapIds) {
    await tx.npcDefinition.deleteMany({
      where: { mapId, key: { notIn: expectedNpcKeysByMap.get(mapId) ?? [] } },
    });
  }

  const expectedMobKeysByMap = new Map<string, string[]>();
  for (const mob of manifest.mobs) {
    const mapId = mapIds.get(mob.mapKey);
    if (!mapId) throw new Error(`Mob ${mob.key} references missing map ${mob.mapKey}.`);
    const expected = expectedMobKeysByMap.get(mapId) ?? [];
    expected.push(mob.key);
    expectedMobKeysByMap.set(mapId, expected);
    await tx.mobDefinition.upsert({
      where: { mapId_key: { mapId, key: mob.key } },
      create: {
        mapId,
        key: mob.key,
        name: mob.name,
        x: mob.x,
        y: mob.y,
        level: mob.level,
        outfitKey: mob.outfitKey,
        stats: mob.stats as unknown as Prisma.InputJsonValue,
        lootTable: mob.lootTable as unknown as Prisma.InputJsonValue,
        respawnMs: mob.respawnMs,
      },
      update: {
        name: mob.name,
        x: mob.x,
        y: mob.y,
        level: mob.level,
        outfitKey: mob.outfitKey,
        stats: mob.stats as unknown as Prisma.InputJsonValue,
        lootTable: mob.lootTable as unknown as Prisma.InputJsonValue,
        respawnMs: mob.respawnMs,
      },
    });
  }
  for (const mapId of managedMapIds) {
    await tx.mobDefinition.deleteMany({
      where: { mapId, key: { notIn: expectedMobKeysByMap.get(mapId) ?? [] } },
    });
  }

  const skillIds = new Map<string, string>();
  for (const skill of manifest.skills) {
    const data = {
      name: skill.name,
      description: skill.description,
      requiredClass: skill.characterClass,
      minimumLevel: skill.minimumLevel,
      energyCost: skill.energyCost,
      cooldownTurns: skill.cooldownTurns,
      targeting: skill.targeting,
      maxRank: skill.maxRank,
      displayOrder: skill.displayOrder,
      treeRow: skill.treeRow,
      treeColumn: skill.treeColumn,
      icon: skill.icon,
      animationKey: skill.animationKey,
      effectDefinition: { operations: skill.effects } as Prisma.InputJsonValue,
      visualDefinition: skill.visual as unknown as Prisma.InputJsonValue,
    };
    const definition = await tx.skillDefinition.upsert({
      where: { key: skill.key },
      create: { key: skill.key, ...data },
      update: data,
    });
    skillIds.set(skill.key, definition.id);
  }
  await tx.skillPrerequisite.deleteMany({
    where: { skillDefinitionId: { in: [...skillIds.values()] } },
  });
  const prerequisites = manifest.skills.flatDal (skill) =>
    skill.prerequisiteKeys.map((prerequisiteKey) => {
      const prerequisiteSkillDefinitionId = skillIds.get(prerequisiteKey);
      if (!prerequisiteSkillDefinitionId) {
        throw new Error(`Skill ${skill.key} references missing prerequisite ${prerequisiteKey}.`);
      }
      return {
        skillDefinitionId: skillIds.get(skill.key)!,
        prerequisiteSkillDefinitionId,
      };
    }),
  );
  if (prerequisites.length > 0) await tx.skillPrerequisite.createMany({ data: prerequisites });

  const defaultMapId = mapIds.get(manifest.realm.defaultMapKey);
  if (!defaultMapId) throw new Error(`Default map ${manifest.realm.defaultMapKey} is missing.`);
  await tx.realm.update({ where: { id: realm.id }, data: { defaultMapId } });
}

@Injectable()
export class ContentDeploymentService {
  constructor(private readonly prisma: PrismaService) {}

  active(): Promise<ContentReleaseRecord | null> {
    return readActiveContentRelease(this.prisma);
  }

  dryRun(compiled: CompiledContentPackage): Promise<ContentDiff> {
    return this.active().then((active) => diffContent(active?.manifest ?? null, compiled.manifest));
  }

  deploy(
    compiled: CompiledContentPackage,
    options: { operationId?: string; author?: string; allowRisky?: boolean } = {},
  ): Promise<ContentDeploymentResult> {
    return deployCompiledContent(this.prisma, compiled, options);
  }

  rollback(
    version: string,
    options: { operationId?: string; author?: string; allowRisky?: boolean } = {},
  ): Promise<ContentDeploymentResult> {
    return rollbackContent(this.prisma, version, options);
  }
}

export async function deployCompiledContent(
  prisma: PrismaClient,
  compiled: CompiledContentPackage,
  options: { operationId?: string; author?: string; allowRisky?: boolean } = {},
): Promise<ContentDeploymentResult> {
  const operationId = options.operationId ?? `content-deploy:${compiled.manifest.version}:${randomUUID()}`;
  const releaseId = randomUUID();
  try {
    return await prisma.$transaction(async (tx) => {
      await acquireContentLock(tx);
      const active = await readActiveContentRelease(tx);
      const existing = await readContentReleaseByVersion(tx, compiled.manifest.version);
      if (existing?.sourceHash && existing.sourceHash !== compiled.sourceHash) {
        throw new Error(
          `Content version ${compiled.manifest.version} already exists with a different source hash.`,
        );
      }
      if (existing?.state === 'ACTIVE' && existing.sourceHash === compiled.sourceHash) {
        return { release: existing, diff: existing.diff, idempotent: true };
      }
      const diff = diffContent(active?.manifest ?? null, compiled.manifest);
      if (diff.risky.length > 0 && !options.allowRisky && active) {
        throw new Error(`Risky content changes require --allow-risky: ${diff.risky.join(', ')}.`);
      }

      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "ContentRelease" (
          "id", "version", "schemaVersion", "sourceHash", "operationId", "state",
          "manifest", "diff", "author", "createdAt"
        ) VALUES (
          ${existing?.id ?? releaseId}::uuid, ${compiled.manifest.version},
          ${compiled.manifest.schemaVersion}, ${compiled.sourceHash}, ${operationId}, 'STAGED',
          ${stableStringify(compiled.manifest)}::jsonb, ${stableStringify(diff)}::jsonb,
          ${options.author ?? null}, NOW()
        )
        ON CONFLICT ("version") DO UPDATE SET
          "schemaVersion" = EXCLUDED."schemaVersion",
          "sourceHash" = EXCLUDED."sourceHash",
          "operationId" = EXCLUDED."operationId",
          "state" = 'STAGED',
          "manifest" = EXCLUDED."manifest",
          "diff" = EXCLUDED."diff",
          "author" = EXCLUDED."author",
          "error" = NULL,
          "activatedAt" = NULL,
          "rolledBackAt" = NULL
      `);

      await applyManifest(tx, compiled.manifest);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "ContentRelease"
        SET "state" = 'ROLLED_BACK', "rolledBackAt" = NOW()
        WHERE "state" = 'ACTIVE' AND "version" <> ${compiled.manifest.version}
      `);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "ContentRelease"
        SET "state" = 'ACTIVE', "activatedAt" = NOW(), "rolledBackAt" = NULL, "error" = NULL
        WHERE "version" = ${compiled.manifest.version}
      `);
      const release = await readContentReleaseByVersion(tx, compiled.manifest.version);
      if (!release) throw new Error('Activated content release could not be read back.');
      return { release, diff, idempotent: false };
    }, { isolationLevel: 'Serializable', timeout: 60_000, maxWait: 10_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "ContentRelease" (
        "id", "version", "schemaVersion", "sourceHash", "operationId", "state",
        "manifest", "diff", "author", "error", "createdAt"
      ) VALUES (
        ${releaseId}::uuid, ${compiled.manifest.version}, ${compiled.manifest.schemaVersion},
        ${compiled.sourceHash}, ${operationId}, 'FAILED',
        ${stableStringify(compiled.manifest)}::jsonb,
        ${stableStringify({ added: [], changed: [], removed: [], risky: [] })}::jsonb,
        ${options.author ?? null}, ${message}, NOW()
      )
      ON CONFLICT ("version") DO UPDATE SET
        "state" = CASE WHEN "ContentRelease"."state" = 'ACTIVE' THEN 'ACTIVE' ELSE 'FAILED' END,
        "operationId" = EXCLUDED."operationId",
        "author" = EXCLUDED."author",
        "error" = EXCLUDED."error"
    `).catch(() => undefined);
    throw error;
  }
}

export async function rollbackContent(
  prisma: PrismaClient,
  version: string,
  options: { operationId?: string; author?: string; allowRisky?: boolean } = {},
): Promise<ContentDeploymentResult> {
  const operationId = options.operationId ?? `content-rollback:${version}:${randomUUID()}`;
  return prisma.$transaction(async (tx) => {
    await acquireContentLock(tx);
    const active = await readActiveContentRelease(tx);
    const target = await readContentReleaseByVersion(tx, version);
    if (!target || target.state === 'FAILED') {
      throw new Error(`Content release ${version} is unavailable.`);
    }
    if (active?.version === version) return { release: target, diff: target.diff, idempotent: true };
    const diff = diffContent(active?.manifest ?? null, target.manifest);
    if (diff.risky.length > 0 && !options.allowRisky) {
      throw new Error(`Risky rollback requires --allow-risky: ${diff.risky.join(', ')}.`);
    }
    await applyManifest(tx, target.manifest);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "ContentRelease"
      SET "state" = 'ROLLED_BACK', "rolledBackAt" = NOW()
      WHERE "state" = 'ACTIVE'
    `);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "ContentRelease"
      SET "state" = 'ACTIVE', "operationId" = ${operationId}, "author" = ${options.author ?? null},
          "activatedAt" = NOW(), "rolledBackAt" = NULL, "error" = NULL,
          "diff" = ${stableStringify(diff)}::jsonb
      WHERE "version" = ${version}
    `);
    const release = await readContentReleaseByVersion(tx, version);
    if (!release) throw new Error('Rolled back content release could not be read back.');
    return { release, diff, idempotent: false };
  }, { isolationLevel: 'Serializable', timeout: 60_000, maxWait: 10_000 });
}
