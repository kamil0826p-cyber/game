import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.ts';
import {
  compileCollisionGrid,
  extractEmbeddedPortals,
  parseTiledMap,
} from '../src/modules/maps/tiled-map.parser.js';
import type {
  EmbeddedPortalDefinition,
  TiledMapJson,
} from '../src/modules/maps/tiled-map.types.js';
import { SKILL_CATALOG } from '../src/modules/skills/skill.catalog.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://game:game@localhost:5432/grid_mmorpg?schema=public';
const realmSlug = process.env.GAME_REALM_SLUG ?? 'world-1';
const realmName = process.env.GAME_REALM_NAME ?? 'World 1';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

interface MapSeedDefinition {
  key: string;
  name: string;
  fileName: string;
  zoneType: 'SAFE' | 'OUTLAW' | 'PVP';
  spawnX: number;
  spawnY: number;
}

interface PreparedMap extends MapSeedDefinition {
  tiledMap: TiledMapJson;
  collision: Uint8Array;
  portals: EmbeddedPortalDefinition[];
}

const mapDefinitions: MapSeedDefinition[] = [
  {
    key: 'greenfields',
    name: 'Greenfields',
    fileName: 'greenfields.json',
    zoneType: 'SAFE',
    spawnX: 4,
    spawnY: 4,
  },
  {
    key: 'crystal-cave',
    name: 'Crystal Cave',
    fileName: 'crystal-cave.json',
    zoneType: 'OUTLAW',
    spawnX: 3,
    spawnY: 3,
  },
];

const borinStock = [
  'traveler-sword',
  'apprentice-staff',
  'field-bow',
  'minor-health-potion',
  'field-rations',
] as const;
const borinDialogue = {
  type: 'MERCHANT',
  rootNodeId: 'welcome',
  nodes: {
    welcome: {
      text: {
        pl: 'Witaj podróżniku, czy chcesz zobaczyć moje towary?',
        en: 'Welcome, traveler. Would you like to see my wares?',
      },
      choices: [
        {
          id: 'show-offer',
          label: { pl: 'Pokaż mi co masz w ofercie!', en: 'Show me what you have for sale!' },
          action: 'OPEN_MERCHANT',
        },
        { id: 'decline', label: { pl: 'Nie, dziękuję', en: 'No, thank you' }, action: 'CLOSE' },
      ],
    },
  },
  merchant: { itemKeys: borinStock, infiniteStock: true },
} as const;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

async function resolveExternalTilesets(input: unknown, mapPath: string): Promise<unknown> {
  if (!isRecord(input) || !Array.isArray(input.tilesets)) return input;
  const tilesets = await Promise.all(
    input.tilesets.map(async (tileset) => {
      if (!isRecord(tileset) || typeof tileset.source !== 'string' || !tileset.source.trim())
        return tileset;
      const tilesetPath = resolve(dirname(mapPath), tileset.source);
      if (!['.json', '.tsj'].includes(extname(tilesetPath).toLowerCase()))
        throw new Error(
          `External tileset ${tileset.source} must be exported as Tiled JSON (.tsj), not TSX/XML.`,
        );
      const external = JSON.parse(await readFile(tilesetPath, 'utf8')) as unknown;
      if (!isRecord(external)) throw new Error(`External tileset ${tileset.source} is malformed.`);
      return {
        ...external,
        firstgid: tileset.firstgid,
        source: tileset.source,
        resolvedSourceUrl: tilesetPath,
      };
    }),
  );
  return { ...input, tilesets };
}

async function loadMap(fileName: string): Promise<TiledMapJson> {
  const mapPath = resolve(currentDirectory, 'maps', fileName);
  const raw = JSON.parse(await readFile(mapPath, 'utf8')) as unknown;
  return parseTiledMap(await resolveExternalTilesets(raw, mapPath));
}

async function prepareMaps(): Promise<PreparedMap[]> {
  const prepared = await Promise.all(
    mapDefinitions.map(async (definition): Promise<PreparedMap> => {
      const tiledMap = await loadMap(definition.fileName);
      const collision = compileCollisionGrid(tiledMap);
      const spawnInside =
        definition.spawnX >= 0 &&
        definition.spawnY >= 0 &&
        definition.spawnX < tiledMap.width &&
        definition.spawnY < tiledMap.height;
      const spawnIndex = definition.spawnY * tiledMap.width + definition.spawnX;
      if (!spawnInside || collision[spawnIndex] === 1)
        throw new Error(`Map ${definition.key} has an invalid seed spawn tile.`);
      return { ...definition, tiledMap, collision, portals: extractEmbeddedPortals(tiledMap) };
    }),
  );

  const mapsByKey = new Map(prepared.map((definition) => [definition.key, definition]));
  if (mapsByKey.size !== prepared.length) throw new Error('Map seed keys must be unique.');

  for (const source of prepared) {
    for (const portal of source.portals) {
      const destination = mapsByKey.get(portal.destinationMapKey);
      if (!destination)
        throw new Error(
          `Portal on ${source.key} references unknown map ${portal.destinationMapKey}.`,
        );
      const sourceInside =
        portal.sourceX >= 0 &&
        portal.sourceY >= 0 &&
        portal.sourceX < source.tiledMap.width &&
        portal.sourceY < source.tiledMap.height;
      const destinationInside =
        portal.targetX >= 0 &&
        portal.targetY >= 0 &&
        portal.targetX < destination.tiledMap.width &&
        portal.targetY < destination.tiledMap.height;
      const sourceBlocked =
        sourceInside &&
        source.collision[portal.sourceY * source.tiledMap.width + portal.sourceX] === 1;
      const destinationBlocked =
        destinationInside &&
        destination.collision[portal.targetY * destination.tiledMap.width + portal.targetX] === 1;
      if (!sourceInside || sourceBlocked || !destinationInside || destinationBlocked)
        throw new Error(`Portal on ${source.key} has an invalid source or target tile.`);
    }
  }

  const greenfields = mapsByKey.get('greenfields');
  if (!greenfields || greenfields.collision[4 * greenfields.tiledMap.width + 6] === 1)
    throw new Error('Borin merchant must be placed on a walkable Greenfields tile.');
  return prepared;
}

async function main(): Promise<void> {
  const preparedMaps = await prepareMaps();
  const result = await prisma.$transaction(async (transaction) => {
    const realm = await transaction.realm.upsert({
      where: { slug: realmSlug },
      create: { slug: realmSlug, name: realmName, isActive: true },
      update: { name: realmName, isActive: true },
    });

    const mapIds = new Map<string, string>();
    for (const definition of preparedMaps) {
      const map = await transaction.map.upsert({
        where: { realmId_key: { realmId: realm.id, key: definition.key } },
        create: {
          realmId: realm.id,
          key: definition.key,
          name: definition.name,
          width: definition.tiledMap.width,
          height: definition.tiledMap.height,
          zoneType: definition.zoneType,
          spawnX: definition.spawnX,
          spawnY: definition.spawnY,
          tiledData: definition.tiledMap as unknown as Prisma.InputJsonValue,
        },
        update: {
          name: definition.name,
          width: definition.tiledMap.width,
          height: definition.tiledMap.height,
          zoneType: definition.zoneType,
          spawnX: definition.spawnX,
          spawnY: definition.spawnY,
          tiledData: definition.tiledMap as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
      mapIds.set(definition.key, map.id);
    }

    for (const definition of preparedMaps) {
      const sourceMapId = mapIds.get(definition.key)!;
      await transaction.portal.deleteMany({ where: { sourceMapId } });
      if (definition.portals.length > 0) {
        await transaction.portal.createMany({
          data: definition.portals.map((portal) => ({
            sourceMapId,
            sourceX: portal.sourceX,
            sourceY: portal.sourceY,
            destinationMapId: mapIds.get(portal.destinationMapKey)!,
            targetX: portal.targetX,
            targetY: portal.targetY,
            enabled: true,
          })),
        });
      }
    }

    const defaultMapId = mapIds.get('greenfields');
    if (!defaultMapId) throw new Error('The greenfields map is required as the realm default.');

    await transaction.npcDefinition.upsert({
      where: { mapId_key: { mapId: defaultMapId, key: 'quartermaster' } },
      create: {
        mapId: defaultMapId,
        key: 'quartermaster',
        name: 'Borin Żelazna Dłoń',
        x: 16,
        y: 6,
        outfitKey: 'npc-warrior-merchant',
        dialogue: borinDialogue,
      },
      update: {
        name: 'Borin Żelazna Dłoń',
        x: 16,
        y: 6,
        outfitKey: 'npc-warrior-merchant',
        dialogue: borinDialogue,
      },
    });

    await transaction.realm.update({ where: { id: realm.id }, data: { defaultMapId } });

    const skillIds = new Map<string, string>();
    for (const skill of SKILL_CATALOG) {
      const definition = await transaction.skillDefinition.upsert({
        where: { key: skill.key },
        create: {
          key: skill.key,
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
          effectDefinition: { operations: skill.effects } as unknown as Prisma.InputJsonValue,
          visualDefinition: skill.visual as unknown as Prisma.InputJsonValue,
        },
        update: {
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
          effectDefinition: { operations: skill.effects } as unknown as Prisma.InputJsonValue,
          visualDefinition: skill.visual as unknown as Prisma.InputJsonValue,
        },
      });
      skillIds.set(skill.key, definition.id);
    }

    await transaction.skillPrerequisite.deleteMany({
      where: { skillDefinitionId: { in: [...skillIds.values()] } },
    });
    const prerequisites = SKILL_CATALOG.flatMap((skill) =>
      skill.prerequisiteKeys.map((prerequisiteKey) => ({
        skillDefinitionId: skillIds.get(skill.key)!,
        prerequisiteSkillDefinitionId: skillIds.get(prerequisiteKey)!,
      })),
    );
    if (prerequisites.length > 0) {
      await transaction.skillPrerequisite.createMany({ data: prerequisites });
    }

    return {
      realmSlug: realm.slug,
      mapCount: preparedMaps.length,
      skillCount: SKILL_CATALOG.length,
    };
  });

  console.log(
    `Seeded realm ${result.realmSlug} with ${result.mapCount} maps, ${result.skillCount} combat skills, and the Borin merchant NPC.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
