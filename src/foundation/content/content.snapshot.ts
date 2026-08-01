import type { Prisma } from '../../generated/prisma/client.js';
import type { ContentManifest, ContentSnapshotRecord } from './content.types.js';

export async function captureContentSnapshot(
  transaction: Prisma.TransactionClient,
  sourceManifest: ContentManifest,
): Promise<ContentSnapshotRecord[]> {
  const [maps, portals, npcs, quests, mobs, skills, items] = await Promise.all([
    transaction.map.findMany({ include: { realm: { select: { slug: true } } } }),
    transaction.portal.findMany({
      include: {
        sourceMap: { include: { realm: { select: { slug: true } } } },
        destinationMap: { include: { realm: { select: { slug: true } } } },
      },
    }),
    transaction.npcDefinition.findMany({
      include: { map: { include: { realm: { select: { slug: true } } } } },
    }),
    transaction.questDefinition.findMany(),
    transaction.mobDefinition.findMany({
      include: { map: { include: { realm: { select: { slug: true } } } } },
    }),
    transaction.skillDefinition.findMany({
      include: {
        prerequisites: {
          include: { prerequisite: { select: { key: true } } },
        },
      },
    }),
    transaction.itemDefinition.findMany(),
  ]);

  const records: ContentSnapshotRecord[] = [];
  for (const map of maps) {
    records.push({
      category: 'maps',
      key: `${map.realm.slug}/${map.key}`,
      payload: {
        realmSlug: map.realm.slug,
        key: map.key,
        name: map.name,
        width: map.width,
        height: map.height,
        zoneType: map.zoneType,
        spawnX: map.spawnX,
        spawnY: map.spawnY,
        tiledData: map.tiledData,
        version: map.version,
      },
    });
  }
  for (const portal of portals) {
    records.push({
      category: 'portals',
      key: `${portal.sourceMap.realm.slug}/${portal.sourceMap.key}:${portal.sourceX},${portal.sourceY}`,
      payload: {
        sourceRealmSlug: portal.sourceMap.realm.slug,
        sourceMapKey: portal.sourceMap.key,
        sourceX: portal.sourceX,
        sourceY: portal.sourceY,
        destinationRealmSlug: portal.destinationMap.realm.slug,
        destinationMapKey: portal.destinationMap.key,
        targetX: portal.targetX,
        targetY: portal.targetY,
        enabled: portal.enabled,
      },
    });
  }
  for (const npc of npcs) {
    records.push({
      category: 'npcs',
      key: `${npc.map.realm.slug}/${npc.map.key}/${npc.key}`,
      payload: {
        realmSlug: npc.map.realm.slug,
        mapKey: npc.map.key,
        key: npc.key,
        name: npc.name,
        x: npc.x,
        y: npc.y,
        outfitKey: npc.outfitKey,
        dialogue: npc.dialogue,
      },
    });
  }
  for (const quest of quests) {
    records.push({
      category: 'quests',
      key: quest.key,
      payload: {
        key: quest.key,
        name: quest.name,
        description: quest.description,
        minimumLevel: quest.minimumLevel,
        steps: quest.steps,
        rewards: quest.rewards,
      },
    });
  }
  for (const mob of mobs) {
    records.push({
      category: 'mobs',
      key: `${mob.map.realm.slug}/${mob.map.key}/${mob.key}`,
      payload: {
        realmSlug: mob.map.realm.slug,
        mapKey: mob.map.key,
        key: mob.key,
        name: mob.name,
        x: mob.x,
        y: mob.y,
        level: mob.level,
        outfitKey: mob.outfitKey,
        stats: mob.stats,
        lootTable: mob.lootTable,
        respawnMs: mob.respawnMs,
      },
    });
  }
  for (const skill of skills) {
    records.push({
      category: 'skills',
      key: skill.key,
      payload: {
        key: skill.key,
        name: skill.name,
        description: skill.description,
        requiredClass: skill.requiredClass,
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
        effectDefinition: skill.effectDefinition,
        visualDefinition: skill.visualDefinition,
        prerequisiteKeys: skill.prerequisites.map((entry) => entry.prerequisite.key),
      },
    });
  }
  for (const item of items) {
    records.push({
      category: 'items',
      key: item.key,
      payload: {
        key: item.key,
        name: item.name,
        description: item.description,
        stackLimit: item.stackLimit,
        metadata: item.metadata,
      },
    });
  }
  for (const encounter of sourceManifest.encounters) {
    records.push({ category: 'encounters', key: encounter.key, payload: encounter });
  }
  for (const lootTable of sourceManifest.lootTables) {
    records.push({ category: 'lootTables', key: lootTable.key, payload: lootTable });
  }
  for (const recipe of sourceManifest.recipes) {
    records.push({ category: 'recipes', key: recipe.key, payload: recipe });
  }
  for (const expedition of sourceManifest.expeditions) {
    records.push({ category: 'expeditions', key: expedition.key, payload: expedition });
  }
  for (const modifier of sourceManifest.modifiers) {
    records.push({ category: 'modifiers', key: modifier.key, payload: modifier });
  }
  return records;
}
