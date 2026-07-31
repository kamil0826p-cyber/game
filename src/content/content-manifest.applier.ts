import { Prisma } from '../generated/prisma/client.js';
import type { CompiledContentManifest } from './content-package.compiler.js';

export async function applyManifest(tx: Prisma.TransactionClient, manifest: CompiledContentManifest): Promise<void> {
  const realm = await tx.realm.upsert({ where: { slug: manifest.realm.slug }, create: { slug: manifest.realm.slug, name: manifest.realm.name, isActive: true }, update: { name: manifest.realm.name, isActive: true } });
  const mapIds = new Map<string, string>();
  for (const definition of manifest.maps) {
    const existing = await tx.map.findUnique({ where: { realmId_key: { realmId: realm.id, key: definition.key } }, select: { version: true } });
    const map = await tx.map.upsert({
      where: { realmId_key: { realmId: realm.id, key: definition.key } },
      create: { realmId: realm.id, key: definition.key, name: definition.name, width: definition.width, height: definition.height, zoneType: definition.zoneType, spawnX: definition.spawnX, spawnY: definition.spawnY, tiledData: definition.tiledData as unknown as Prisma.InputJsonValue, version: 1 },
      update: { name: definition.name, width: definition.width, height: definition.height, zoneType: definition.zoneType, spawnX: definition.spawnX, spawnY: definition.spawnY, tiledData: definition.tiledData as unknown as Prisma.InputJsonValue, version: (existing?.version ?? 0) + 1 },
    });
    mapIds.set(definition.key, map.id);
  }
  for (const definition of manifest.maps) {
    const sourceMapId = mapIds.get(definition.key); if (!sourceMapId) throw new Error(`Map ${definition.key} was not deployed.`);
    await tx.portal.deleteMany({ where: { sourceMapId } });
    if (definition.portals.length) await tx.portal.createMany({ data: definition.portals.map((portal) => {
      const destinationMapId = mapIds.get(portal.destinationMapKey); if (!destinationMapId) throw new Error(`Portal on ${definition.key} references ${portal.destinationMapKey}.`);
      return { sourceMapId, sourceX: portal.sourceX, sourceY: portal.sourceY, destinationMapId, targetX: portal.targetX, targetY: portal.targetY, enabled: true };
    }) });
  }
  for (const item of manifest.items) await tx.itemDefinition.upsert({
    where: { key: item.key },
    create: { key: item.key, name: item.name, description: item.description, stackLimit: item.stackLimit, metadata: item.metadata as Prisma.InputJsonValue },
    update: { name: item.name, description: item.description, stackLimit: item.stackLimit, metadata: item.metadata as Prisma.InputJsonValue },
  });
  for (const quest of manifest.quests) await tx.questDefinition.upsert({
    where: { key: quest.key },
    create: { key: quest.key, name: quest.name, description: quest.description, minimumLevel: quest.minimumLevel, steps: quest.steps as Prisma.InputJsonValue, rewards: quest.rewards as Prisma.InputJsonValue },
    update: { name: quest.name, description: quest.description, minimumLevel: quest.minimumLevel, steps: quest.steps as Prisma.InputJsonValue, rewards: quest.rewards as Prisma.InputJsonValue },
  });
  const managedMapIds = [...mapIds.values()];
  const expectedNpcKeysByMap = new Map<string, string[]>();
  for (const npc of manifest.npcs) {
    const mapId = mapIds.get(npc.mapKey); if (!mapId) throw new Error(`NPC ${npc.key} references missing map ${npc.mapKey}.`);
    expectedNpcKeysByMap.set(mapId, [...(expectedNpcKeysByMap.get(mapId) ?? []), npc.key]);
    await tx.npcDefinition.upsert({ where: { mapId_key: { mapId, key: npc.key } }, create: { mapId, key: npc.key, name: npc.name, x: npc.x, y: npc.y, outfitKey: npc.outfitKey, dialogue: npc.dialogue as unknown as Prisma.InputJsonValue }, update: { name: npc.name, x: npc.x, y: npc.y, outfitKey: npc.outfitKey, dialogue: npc.dialogue as unknown as Prisma.InputJsonValue } });
  }
  for (const mapId of managedMapIds) await tx.npcDefinition.deleteMany({ where: { mapId, key: { notIn: expectedNpcKeysByMap.get(mapId) ?? [] } } });
  const expectedMobKeysByMap = new Map<string, string[]>();
  for (const mob of manifest.mobs) {
    const mapId = mapIds.get(mob.mapKey); if (!mapId) throw new Error(`Mob ${mob.key} references missing map ${mob.mapKey}.`);
    expectedMobKeysByMap.set(mapId, [...(expectedMobKeysByMap.get(mapId) ?? []), mob.key]);
    await tx.mobDefinition.upsert({ where: { mapId_key: { mapId, key: mob.key } }, create: { mapId, key: mob.key, name: mob.name, x: mob.x, y: mob.y, level: mob.level, outfitKey: mob.outfitKey, stats: mob.stats as unknown as Prisma.InputJsonValue, lootTable: mob.lootTable as unknown as Prisma.InputJsonValue, respawnMs: mob.respawnMs }, update: { name: mob.name, x: mob.x, y: mob.y, level: mob.level, outfitKey: mob.outfitKey, stats: mob.stats as unknown as Prisma.InputJsonValue, lootTable: mob.lootTable as unknown as Prisma.InputJsonValue, respawnMs: mob.respawnMs } });
  }
  for (const mapId of managedMapIds) await tx.mobDefinition.deleteMany({ where: { mapId, key: { notIn: expectedMobKeysByMap.get(mapId) ?? [] } } });
  const skillIds = new Map<string, string>();
  for (const skill of manifest.skills) {
    const data = { name: skill.name, description: skill.description, requiredClass: skill.characterClass, minimumLevel: skill.minimumLevel, energyCost: skill.energyCost, cooldownTurns: skill.cooldownTurns, targeting: skill.targeting, maxRank: skill.maxRank, displayOrder: skill.displayOrder, treeRow: skill.treeRow, treeColumn: skill.treeColumn, icon: skill.icon, animationKey: skill.animationKey, effectDefinition: { operations: skill.effects } as Prisma.InputJsonValue, visualDefinition: skill.visual as unknown as Prisma.InputJsonValue };
    const definition = await tx.skillDefinition.upsert({ where: { key: skill.key }, create: { key: skill.key, ...data }, update: data });
    skillIds.set(skill.key, definition.id);
  }
  await tx.skillPrerequisite.deleteMany({ where: { skillDefinitionId: { in: [...skillIds.values()] } } });
  const prerequisites = manifest.skills.flatMap((skill) => skill.prerequisiteKeys.map((prerequisiteKey) => {
    const prerequisiteSkillDefinitionId = skillIds.get(prerequisiteKey); if (!prerequisiteSkillDefinitionId) throw new Error(`Skill ${skill.key} references missing prerequisite ${prerequisiteKey}.`);
    return { skillDefinitionId: skillIds.get(skill.key)!, prerequisiteSkillDefinitionId };
  }));
  if (prerequisites.length) await tx.skillPrerequisite.createMany({ data: prerequisites });
  const defaultMapId = mapIds.get(manifest.realm.defaultMapKey); if (!defaultMapId) throw new Error(`Default map ${manifest.realm.defaultMapKey} is missing.`);
  await tx.realm.update({ where: { id: realm.id }, data: { defaultMapId } });
}
