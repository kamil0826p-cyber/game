import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { stableContentHash } from './content.canonical.js';
import type { ContentSnapshotRecord } from './content.types.js';

const record = (value: unknown, context: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid content snapshot payload for ${context}.`);
  }
  return value as Record<string, unknown>;
};

const text = (value: unknown, context: string): string => {
  if (typeof value !== 'string') throw new Error(`Missing ${context}.`);
  return value;
};

const integer = (value: unknown, context: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Invalid ${context}.`);
  }
  return value;
};

const optionalText = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

const byCategory = (
  snapshots: readonly { category: string; key: string; payload: Prisma.JsonValue }[],
  category: ContentSnapshotRecord['category'],
): ContentSnapshotRecord[] =>
  snapshots
    .filter((snapshot) => snapshot.category === category)
    .map((snapshot) => ({ category, key: snapshot.key, payload: snapshot.payload }));

export async function rollbackContentVersion(
  prisma: PrismaClient,
  targetHash: string,
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtext('game-content-deployment'))
    `;
    const target = await transaction.contentVersion.findUnique({
      where: { hash: targetHash },
      include: { snapshots: true },
    });
    if (!target) throw new Error(`Unknown content version ${targetHash}.`);

    const snapshotRecords = target.snapshots.map((snapshot) => ({
      category: snapshot.category as ContentSnapshotRecord['category'],
      key: snapshot.key,
      payload: snapshot.payload,
    }));
    for (const snapshot of target.snapshots) {
      if (stableContentHash(snapshot.payload) !== snapshot.payloadHash) {
        throw new Error(
          `Content snapshot ${snapshot.category}/${snapshot.key} failed integrity verification.`,
        );
      }
    }
    const verifiedHash = stableContentHash({
      schemaVersion: target.schemaVersion,
      records: snapshotRecords,
    });
    if (verifiedHash !== target.hash) {
      throw new Error(`Content version ${targetHash} failed package integrity verification.`);
    }

    const current = await transaction.activeContentVersion.findUnique({
      where: { id: 'active' },
    });
    const realms = new Map(
      (await transaction.realm.findMany()).map((realm) => [realm.slug, realm]),
    );
    const mapIds = new Map<string, string>();

    for (const snapshot of byCategory(target.snapshots, 'maps')) {
      const payload = record(snapshot.payload, snapshot.key);
      const realmSlug = text(payload.realmSlug, `${snapshot.key}.realmSlug`);
      const realm = realms.get(realmSlug);
      if (!realm) throw new Error(`Rollback target references missing realm ${realmSlug}.`);
      const key = text(payload.key, `${snapshot.key}.key`);
      const map = await transaction.map.upsert({
        where: { realmId_key: { realmId: realm.id, key } },
        create: {
          realmId: realm.id,
          key,
          name: text(payload.name, `${snapshot.key}.name`),
          width: integer(payload.width, `${snapshot.key}.width`),
          height: integer(payload.height, `${snapshot.key}.height`),
          zoneType: text(payload.zoneType, `${snapshot.key}.zoneType`) as
            | 'SAFE'
            | 'OUTLAW'
            | 'PVP',
          spawnX: integer(payload.spawnX, `${snapshot.key}.spawnX`),
          spawnY: integer(payload.spawnY, `${snapshot.key}.spawnY`),
          tiledData: json(payload.tiledData),
          version: integer(payload.version, `${snapshot.key}.version`),
        },
        update: {
          name: text(payload.name, `${snapshot.key}.name`),
          width: integer(payload.width, `${snapshot.key}.width`),
          height: integer(payload.height, `${snapshot.key}.height`),
          zoneType: text(payload.zoneType, `${snapshot.key}.zoneType`) as
            | 'SAFE'
            | 'OUTLAW'
            | 'PVP',
          spawnX: integer(payload.spawnX, `${snapshot.key}.spawnX`),
          spawnY: integer(payload.spawnY, `${snapshot.key}.spawnY`),
          tiledData: json(payload.tiledData),
          version: integer(payload.version, `${snapshot.key}.version`),
        },
      });
      mapIds.set(`${realmSlug}/${key}`, map.id);
    }

    for (const snapshot of byCategory(target.snapshots, 'portals')) {
      const payload = record(snapshot.payload, snapshot.key);
      const sourceKey = `${text(
        payload.sourceRealmSlug,
        `${snapshot.key}.sourceRealmSlug`,
      )}/${text(payload.sourceMapKey, `${snapshot.key}.sourceMapKey`)}`;
      const destinationKey = `${text(
        payload.destinationRealmSlug,
        `${snapshot.key}.destinationRealmSlug`,
      )}/${text(payload.destinationMapKey, `${snapshot.key}.destinationMapKey`)}`;
      const sourceMapId = mapIds.get(sourceKey);
      const destinationMapId = mapIds.get(destinationKey);
      if (!sourceMapId || !destinationMapId) {
        throw new Error(`Rollback portal ${snapshot.key} references a missing map.`);
      }
      const sourceX = integer(payload.sourceX, `${snapshot.key}.sourceX`);
      const sourceY = integer(payload.sourceY, `${snapshot.key}.sourceY`);
      await transaction.portal.upsert({
        where: { sourceMapId_sourceX_sourceY: { sourceMapId, sourceX, sourceY } },
        create: {
          sourceMapId,
          sourceX,
          sourceY,
          destinationMapId,
          targetX: integer(payload.targetX, `${snapshot.key}.targetX`),
          targetY: integer(payload.targetY, `${snapshot.key}.targetY`),
          enabled: payload.enabled !== false,
        },
        update: {
          destinationMapId,
          targetX: integer(payload.targetX, `${snapshot.key}.targetX`),
          targetY: integer(payload.targetY, `${snapshot.key}.targetY`),
          enabled: payload.enabled !== false,
        },
      });
    }

    for (const snapshot of byCategory(target.snapshots, 'items')) {
      const payload = record(snapshot.payload, snapshot.key);
      const key = text(payload.key, `${snapshot.key}.key`);
      const data = {
        name: text(payload.name, `${snapshot.key}.name`),
        description: text(payload.description, `${snapshot.key}.description`),
        stackLimit: integer(payload.stackLimit, `${snapshot.key}.stackLimit`),
        metadata: json(payload.metadata),
      };
      await transaction.itemDefinition.upsert({
        where: { key },
        create: { key, ...data },
        update: data,
      });
    }

    for (const snapshot of byCategory(target.snapshots, 'quests')) {
      const payload = record(snapshot.payload, snapshot.key);
      const key = text(payload.key, `${snapshot.key}.key`);
      const data = {
        name: text(payload.name, `${snapshot.key}.name`),
        description: text(payload.description, `${snapshot.key}.description`),
        minimumLevel: integer(payload.minimumLevel, `${snapshot.key}.minimumLevel`),
        steps: json(payload.steps),
        rewards: json(payload.rewards),
      };
      await transaction.questDefinition.upsert({
        where: { key },
        create: { key, ...data },
        update: data,
      });
    }

    const skillPrerequisites = new Map<string, string[]>();
    for (const snapshot of byCategory(target.snapshots, 'skills')) {
      const payload = record(snapshot.payload, snapshot.key);
      const key = text(payload.key, `${snapshot.key}.key`);
      const prerequisiteKeys = Array.isArray(payload.prerequisiteKeys)
        ? payload.prerequisiteKeys.map((entry) =>
            text(entry, `${snapshot.key}.prerequisiteKeys`),
          )
        : [];
      skillPrerequisites.set(key, prerequisiteKeys);
      const data = {
        name: text(payload.name, `${snapshot.key}.name`),
        description: text(payload.description, `${snapshot.key}.description`),
        requiredClass: optionalText(payload.requiredClass) as
          | 'MAGE'
          | 'WARRIOR'
          | 'ARCHER'
          | null,
        minimumLevel: integer(payload.minimumLevel, `${snapshot.key}.minimumLevel`),
        energyCost: integer(payload.energyCost, `${snapshot.key}.energyCost`),
        cooldownTurns: integer(payload.cooldownTurns, `${snapshot.key}.cooldownTurns`),
        targeting: text(payload.targeting, `${snapshot.key}.targeting`) as
          | 'SELF'
          | 'ENEMY'
          | 'AREA',
        maxRank: integer(payload.maxRank, `${snapshot.key}.maxRank`),
        displayOrder: integer(payload.displayOrder, `${snapshot.key}.displayOrder`),
        treeRow: integer(payload.treeRow, `${snapshot.key}.treeRow`),
        treeColumn: integer(payload.treeColumn, `${snapshot.key}.treeColumn`),
        icon: text(payload.icon, `${snapshot.key}.icon`),
        animationKey: text(payload.animationKey, `${snapshot.key}.animationKey`),
        effectDefinition: json(payload.effectDefinition),
        visualDefinition: json(payload.visualDefinition),
      };
      await transaction.skillDefinition.upsert({
        where: { key },
        create: { key, ...data },
        update: data,
      });
    }

    const skills = new Map(
      (
        await transaction.skillDefinition.findMany({ select: { id: true, key: true } })
      ).map((skill) => [skill.key, skill.id]),
    );
    for (const [skillKey, prerequisites] of skillPrerequisites) {
      const skillDefinitionId = skills.get(skillKey);
      if (!skillDefinitionId) {
        throw new Error(`Rollback skill ${skillKey} was not written.`);
      }
      await transaction.skillPrerequisite.deleteMany({ where: { skillDefinitionId } });
      for (const prerequisiteKey of prerequisites) {
        const prerequisiteSkillDefinitionId = skills.get(prerequisiteKey);
        if (!prerequisiteSkillDefinitionId) {
          throw new Error(
            `Rollback skill ${skillKey} references missing prerequisite ${prerequisiteKey}.`,
          );
        }
        await transaction.skillPrerequisite.create({
          data: { skillDefinitionId, prerequisiteSkillDefinitionId },
        });
      }
    }

    for (const snapshot of byCategory(target.snapshots, 'npcs')) {
      const payload = record(snapshot.payload, snapshot.key);
      const mapKey = `${text(payload.realmSlug, `${snapshot.key}.realmSlug`)}/${text(
        payload.mapKey,
        `${snapshot.key}.mapKey`,
      )}`;
      const mapId = mapIds.get(mapKey);
      if (!mapId) {
        throw new Error(`Rollback NPC ${snapshot.key} references missing map ${mapKey}.`);
      }
      const key = text(payload.key, `${snapshot.key}.key`);
      const data = {
        name: text(payload.name, `${snapshot.key}.name`),
        x: integer(payload.x, `${snapshot.key}.x`),
        y: integer(payload.y, `${snapshot.key}.y`),
        outfitKey: text(payload.outfitKey, `${snapshot.key}.outfitKey`),
        dialogue: json(payload.dialogue),
      };
      await transaction.npcDefinition.upsert({
        where: { mapId_key: { mapId, key } },
        create: { mapId, key, ...data },
        update: data,
      });
    }

    for (const snapshot of byCategory(target.snapshots, 'mobs')) {
      const payload = record(snapshot.payload, snapshot.key);
      const mapKey = `${text(payload.realmSlug, `${snapshot.key}.realmSlug`)}/${text(
        payload.mapKey,
        `${snapshot.key}.mapKey`,
      )}`;
      const mapId = mapIds.get(mapKey);
      if (!mapId) {
        throw new Error(`Rollback mob ${snapshot.key} references missing map ${mapKey}.`);
      }
      const key = text(payload.key, `${snapshot.key}.key`);
      const data = {
        name: text(payload.name, `${snapshot.key}.name`),
        x: integer(payload.x, `${snapshot.key}.x`),
        y: integer(payload.y, `${snapshot.key}.y`),
        level: integer(payload.level, `${snapshot.key}.level`),
        outfitKey: text(payload.outfitKey, `${snapshot.key}.outfitKey`),
        stats: json(payload.stats),
        lootTable: json(payload.lootTable),
        respawnMs: integer(payload.respawnMs, `${snapshot.key}.respawnMs`),
      };
      await transaction.mobDefinition.upsert({
        where: { mapId_key: { mapId, key } },
        create: { mapId, key, ...data },
        update: data,
      });
    }

    if (current && current.contentVersionId !== target.id) {
      await transaction.contentVersion.update({
        where: { id: current.contentVersionId },
        data: { status: 'ROLLED_BACK', rolledBackAt: new Date() },
      });
    }
    await transaction.contentVersion.update({
      where: { id: target.id },
      data: { status: 'ACTIVE', activatedAt: new Date(), rolledBackAt: null },
    });
    await transaction.activeContentVersion.upsert({
      where: { id: 'active' },
      create: { id: 'active', contentVersionId: target.id },
      update: { contentVersionId: target.id },
    });
  });
}
