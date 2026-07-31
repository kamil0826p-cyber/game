import type { PoolClient } from 'pg';
import type { ContentSnapshot } from './content-validator.js';

export const loadDeployedContentSnapshot = async (client: PoolClient): Promise<ContentSnapshot> => {
  const [maps, portals, items, skills, skillPrerequisites, quests, npcs, mobs] = await Promise.all([
    client.query<ContentSnapshot['maps'][number]>(`
      SELECT id, key, name, width, height,
             "spawnX", "spawnY", "tiledData", version
      FROM "Map"
      ORDER BY key, id
    `),
    client.query<ContentSnapshot['portals'][number]>(`
      SELECT id, "sourceMapId", "sourceX", "sourceY",
             "destinationMapId", "targetX", "targetY"
      FROM "Portal"
      ORDER BY id
    `),
    client.query<ContentSnapshot['items'][number]>(`
      SELECT id, key, name, description, "stackLimit", metadata
      FROM "ItemDefinition"
      ORDER BY key, id
    `),
    client.query<ContentSnapshot['skills'][number]>(`
      SELECT id, key, name, description, "minimumLevel", "energyCost",
             "cooldownTurns", "maxRank", "effectDefinition", "visualDefinition"
      FROM "SkillDefinition"
      ORDER BY key, id
    `),
    client.query<ContentSnapshot['skillPrerequisites'][number]>(`
      SELECT "skillDefinitionId", "prerequisiteSkillDefinitionId"
      FROM "SkillPrerequisite"
      ORDER BY "skillDefinitionId", "prerequisiteSkillDefinitionId"
    `),
    client.query<ContentSnapshot['quests'][number]>(`
      SELECT id, key, name, description, "minimumLevel", steps, rewards
      FROM "QuestDefinition"
      ORDER BY key, id
    `),
    client.query<ContentSnapshot['npcs'][number]>(`
      SELECT id, "mapId", key, name, x, y, dialogue
      FROM "NpcDefinition"
      ORDER BY "mapId", key, id
    `),
    client.query<ContentSnapshot['mobs'][number]>(`
      SELECT id, "mapId", key, name, x, y, level, stats, "lootTable", "respawnMs"
      FROM "MobDefinition"
      ORDER BY "mapId", key, id
    `),
  ]);

  return {
    maps: maps.rows,
    portals: portals.rows,
    items: items.rows,
    skills: skills.rows,
    skillPrerequisites: skillPrerequisites.rows,
    quests: quests.rows,
    npcs: npcs.rows,
    mobs: mobs.rows,
  };
};
