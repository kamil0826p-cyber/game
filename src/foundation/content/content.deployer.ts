import { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { diffContentManifests, validateContentManifest } from './content.compiler.js';
import {
  CONTENT_SECTIONS,
  type CompiledContentPackage,
  type GameContentManifest,
} from './content.types.js';

interface ActiveReleaseRow {
  id: string;
  sequence: bigint;
  hash: string;
  manifest: GameContentManifest;
}

interface ReleaseRow extends ActiveReleaseRow {
  schemaVersion: number;
}

export interface ContentDeploymentOptions {
  realmSlug: string;
  realmName: string;
  activationReason?: 'DEPLOY' | 'ROLLBACK';
}

export interface ContentDeploymentResult {
  replayed: boolean;
  hash: string;
  sequence: number;
  mapCount: number;
  skillCount: number;
  mobCount: number;
  questCount: number;
}

const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

async function lockContentState(
  transaction: Prisma.TransactionClient,
): Promise<ActiveReleaseRow | undefined> {
  await transaction.$executeRaw(Prisma.sql`
    INSERT INTO "ContentState" ("key", "updatedAt")
    VALUES ('global', CURRENT_TIMESTAMP)
    ON CONFLICT ("key") DO NOTHING
  `);
  const rows = await transaction.$queryRaw<ActiveReleaseRow[]>(Prisma.sql`
    SELECT release."id", release."sequence", release."hash", release."manifest"
    FROM "ContentState" state
    LEFT JOIN "ContentRelease" release ON release."id" = state."activeReleaseId"
    WHERE state."key" = 'global'
    FOR UPDATE OF state
  `);
  return rows[0]?.id ? rows[0] : undefined;
}

async function setDefinitionContentHash(
  transaction: Prisma.TransactionClient,
  table: 'Map' | 'ItemDefinition' | 'QuestDefinition' | 'NpcDefinition' | 'MobDefinition' | 'SkillDefinition',
  id: string,
  hash: string,
): Promise<void> {
  const tableName = Prisma.raw(`"${table}"`);
  await transaction.$executeRaw(Prisma.sql`
    UPDATE ${tableName} SET "contentHash" = ${hash} WHERE "id" = ${id}::uuid
  `);
}

async function projectManifest(
  transaction: Prisma.TransactionClient,
  compiled: CompiledContentPackage,
  options: ContentDeploymentOptions,
): Promise<void> {
  const { manifest, hash } = compiled;
  const realm = await transaction.realm.upsert({
    where: { slug: options.realmSlug },
    create: { slug: options.realmSlug, name: options.realmName, isActive: true },
    update: { name: options.realmName, isActive: true },
  });

  const mapIds = new Map<string, string>();
  for (const definition of manifest.maps) {
    const map = await transaction.map.upsert({
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
        tiledData: asJson(definition.tiledData),
      },
      update: {
        name: definition.name,
        width: definition.width,
        height: definition.height,
        zoneType: definition.zoneType,
        spawnX: definition.spawnX,
        spawnY: definition.spawnY,
        tiledData: asJson(definition.tiledData),
        version: { increment: 1 },
      },
    });
    mapIds.set(definition.key, map.id);
    await setDefinitionContentHash(transaction, 'Map', map.id, hash);
  }

  for (const mapId of mapIds.values()) {
    await transaction.portal.deleteMany({ where: { sourceMapId: mapId } });
  }
  if (manifest.portals.length > 0) {
    await transaction.portal.createMany({
      data: manifest.portals.map((portal) => ({
        sourceMapId: mapIds.get(portal.sourceMapKey)!,
        sourceX: portal.sourceX,
        sourceY: portal.sourceY,
        destinationMapId: mapIds.get(portal.destinationMapKey)!,
        targetX: portal.targetX,
        targetY: portal.targetY,
        enabled: portal.enabled,
      })),
    });
  }

  for (const item of manifest.items) {
    const definition = await transaction.itemDefinition.upsert({
      where: { key: item.key },
      create: {
        key: item.key,
        name: item.name,
        description: item.description,
        stackLimit: item.stackLimit,
        metadata: asJson(item.metadata),
      },
      update: {
        name: item.name,
        description: item.description,
        stackLimit: item.stackLimit,
        metadata: asJson(item.metadata),
      },
    });
    await setDefinitionContentHash(transaction, 'ItemDefinition', definition.id, hash);
  }

  for (const quest of manifest.quests) {
    const definition = await transaction.questDefinition.upsert({
      where: { key: quest.key },
      create: {
        key: quest.key,
        name: quest.name,
        description: quest.description,
        minimumLevel: quest.minimumLevel,
        steps: asJson(quest.steps),
        rewards: asJson(quest.rewards),
      },
      update: {
        name: quest.name,
        description: quest.description,
        minimumLevel: quest.minimumLevel,
        steps: asJson(quest.steps),
        rewards: asJson(quest.rewards),
      },
    });
    await setDefinitionContentHash(transaction, 'QuestDefinition', definition.id, hash);
  }

  for (const npc of manifest.npcs) {
    const mapId = mapIds.get(npc.mapKey);
    if (!mapId) throw new Error(`Map ${npc.mapKey} was not projected for NPC ${npc.key}.`);
    const definition = await transaction.npcDefinition.upsert({
      where: { mapId_key: { mapId, key: npc.key } },
      create: {
        mapId,
        key: npc.key,
        name: npc.name,
        x: npc.x,
        y: npc.y,
        outfitKey: npc.outfitKey,
        dialogue: asJson(npc.dialogue),
      },
      update: {
        name: npc.name,
        x: npc.x,
        y: npc.y,
        outfitKey: npc.outfitKey,
        dialogue: asJson(npc.dialogue),
      },
    });
    await setDefinitionContentHash(transaction, 'NpcDefinition', definition.id, hash);
  }

  const lootByKey = new Map(
    manifest.lootTables.map((lootTable) => [lootTable.key, lootTable.entries]),
  );
  for (const mob of manifest.mobs) {
    const mapId = mapIds.get(mob.mapKey);
    if (!mapId) throw new Error(`Map ${mob.mapKey} was not projected for mob ${mob.key}.`);
    const definition = await transaction.mobDefinition.upsert({
      where: { mapId_key: { mapId, key: mob.key } },
      create: {
        mapId,
        key: mob.key,
        name: mob.name,
        x: mob.x,
        y: mob.y,
        level: mob.level,
        outfitKey: mob.outfitKey,
        stats: asJson(mob.stats),
        lootTable: asJson(lootByKey.get(mob.lootTableKey) ?? []),
        respawnMs: mob.respawnMs,
      },
      update: {
        name: mob.name,
        x: mob.x,
        y: mob.y,
        level: mob.level,
        outfitKey: mob.outfitKey,
        stats: asJson(mob.stats),
        lootTable: asJson(lootByKey.get(mob.lootTableKey) ?? []),
        respawnMs: mob.respawnMs,
      },
    });
    await setDefinitionContentHash(transaction, 'MobDefinition', definition.id, hash);
  }

  const skillIds = new Map<string, string>();
  for (const skill of manifest.skills) {
    const definition = await transaction.skillDefinition.upsert({
      where: { key: skill.key },
      create: {
        key: skill.key,
        name: skill.name,
        description: skill.description,
        requiredClass: skill.requiredClass ?? null,
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
        effectDefinition: asJson(skill.effectDefinition),
        visualDefinition: asJson(skill.visualDefinition),
      },
      update: {
        name: skill.name,
        description: skill.description,
        requiredClass: skill.requiredClass ?? null,
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
        effectDefinition: asJson(skill.effectDefinition),
        visualDefinition: asJson(skill.visualDefinition),
      },
    });
    skillIds.set(skill.key, definition.id);
    await setDefinitionContentHash(transaction, 'SkillDefinition', definition.id, hash);
  }
  if (skillIds.size > 0) {
    await transaction.skillPrerequisite.deleteMany({
      where: { skillDefinitionId: { in: [...skillIds.values()] } },
    });
    const prerequisites = manifest.skills.flatMap((skill) =>
      skill.prerequisiteKeys.map((prerequisiteKey) => ({
        skillDefinitionId: skillIds.get(skill.key)!,
        prerequisiteSkillDefinitionId: skillIds.get(prerequisiteKey)!,
      })),
    );
    if (prerequisites.length > 0) {
      await transaction.skillPrerequisite.createMany({ data: prerequisites });
    }
  }

  for (const mapId of mapIds.values()) {
    await transaction.$executeRaw(Prisma.sql`
      DELETE FROM "NpcDefinition"
      WHERE "mapId" = ${mapId}::uuid
        AND "contentHash" IS NOT NULL
        AND "contentHash" <> ${hash}
    `);
    await transaction.$executeRaw(Prisma.sql`
      DELETE FROM "MobDefinition"
      WHERE "mapId" = ${mapId}::uuid
        AND "contentHash" IS NOT NULL
        AND "contentHash" <> ${hash}
    `);
  }

  const defaultMapId = mapIds.get(manifest.defaultMapKey);
  if (!defaultMapId) throw new Error(`Default map ${manifest.defaultMapKey} was not projected.`);
  await transaction.realm.update({ where: { id: realm.id }, data: { defaultMapId } });
}

async function storeDefinitions(
  transaction: Prisma.TransactionClient,
  releaseId: string,
  manifest: GameContentManifest,
): Promise<void> {
  await transaction.$executeRaw(Prisma.sql`
    DELETE FROM "ContentDefinition" WHERE "releaseId" = ${releaseId}::uuid
  `);
  for (const section of CONTENT_SECTIONS) {
    for (const definition of manifest[section]) {
      await transaction.$executeRaw(Prisma.sql`
        INSERT INTO "ContentDefinition" ("releaseId", "section", "key", "body")
        VALUES (
          ${releaseId}::uuid,
          ${section},
          ${definition.key},
          CAST(${JSON.stringify(definition)} AS jsonb)
        )
      `);
    }
  }
}

export async function readActiveContentManifest(
  prisma: PrismaClient,
): Promise<GameContentManifest | undefined> {
  const rows = await prisma.$queryRaw<Array<{ manifest: GameContentManifest }>>(Prisma.sql`
    SELECT release."manifest"
    FROM "ContentState" state
    JOIN "ContentRelease" release ON release."id" = state."activeReleaseId"
    WHERE state."key" = 'global'
    LIMIT 1
  `);
  return rows[0]?.manifest;
}

export async function deployContentPackage(
  prisma: PrismaClient,
  compiled: CompiledContentPackage,
  options: ContentDeploymentOptions,
): Promise<ContentDeploymentResult> {
  validateContentManifest(compiled.manifest);
  return prisma.$transaction(async (transaction) => {
    const active = await lockContentState(transaction);
    if (active?.hash === compiled.hash) {
      return {
        replayed: true,
        hash: active.hash,
        sequence: Number(active.sequence),
        mapCount: compiled.manifest.maps.length,
        skillCount: compiled.manifest.skills.length,
        mobCount: compiled.manifest.mobs.length,
        questCount: compiled.manifest.quests.length,
      };
    }

    const logicalDiff = diffContentManifests(active?.manifest, compiled.manifest);
    await projectManifest(transaction, compiled, options);
    const releases = await transaction.$queryRaw<Array<{ id: string; sequence: bigint }>>(Prisma.sql`
      INSERT INTO "ContentRelease" (
        "hash", "schemaVersion", "manifest", "logicalDiff", "status", "activatedAt"
      ) VALUES (
        ${compiled.hash},
        ${compiled.manifest.schemaVersion},
        CAST(${JSON.stringify(compiled.manifest)} AS jsonb),
        CAST(${JSON.stringify(logicalDiff)} AS jsonb),
        'ACTIVE',
        CURRENT_TIMESTAMP
      )
      ON CONFLICT ("hash") DO UPDATE SET
        "manifest" = EXCLUDED."manifest",
        "logicalDiff" = EXCLUDED."logicalDiff",
        "status" = 'ACTIVE',
        "activatedAt" = CURRENT_TIMESTAMP,
        "rolledBackAt" = NULL
      RETURNING "id", "sequence"
    `);
    const release = releases[0];
    if (!release) throw new Error('Content release could not be persisted.');

    if (active) {
      await transaction.$executeRaw(Prisma.sql`
        UPDATE "ContentRelease"
        SET "status" = ${options.activationReason === 'ROLLBACK' ? 'ROLLED_BACK' : 'SUPERSEDED'},
            "rolledBackAt" = ${options.activationReason === 'ROLLBACK' ? new Date() : null}
        WHERE "id" = ${active.id}::uuid
      `);
    }
    await storeDefinitions(transaction, release.id, compiled.manifest);
    await transaction.$executeRaw(Prisma.sql`
      UPDATE "ContentState"
      SET "activeReleaseId" = ${release.id}::uuid,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "key" = 'global'
    `);

    return {
      replayed: false,
      hash: compiled.hash,
      sequence: Number(release.sequence),
      mapCount: compiled.manifest.maps.length,
      skillCount: compiled.manifest.skills.length,
      mobCount: compiled.manifest.mobs.length,
      questCount: compiled.manifest.quests.length,
    };
  });
}

export async function readContentRelease(
  prisma: PrismaClient,
  target: string,
): Promise<ReleaseRow | undefined> {
  const numericTarget = /^\d+$/.test(target) ? BigInt(target) : undefined;
  const rows = await prisma.$queryRaw<ReleaseRow[]>(
    numericTarget === undefined
      ? Prisma.sql`
          SELECT "id", "sequence", "hash", "schemaVersion", "manifest"
          FROM "ContentRelease"
          WHERE "hash" = ${target}
          LIMIT 1
        `
      : Prisma.sql`
          SELECT "id", "sequence", "hash", "schemaVersion", "manifest"
          FROM "ContentRelease"
          WHERE "sequence" = ${numericTarget}
          LIMIT 1
        `,
  );
  return rows[0];
}
