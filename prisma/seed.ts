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

interface MobSeedDefinition {
  key: string;
  name: string;
  mapKey: string;
  level: number;
  outfitKey: string;
  spawnPoints: Array<{ x: number; y: number }>;
  respawnMs: number;
  stats: {
    rank: 'SPAWN' | 'EXECUTIONER' | 'ARCH_EXECUTIONER' | 'REAPER' | 'ANCIENT';
    characterClass: 'MAGE' | 'WARRIOR' | 'ARCHER';
    experience: number;
    maxHp: number;
    maxEnergy: number;
    strength: number;
    agility: number;
    intelligence: number;
    armor: number;
  };
  lootTable: Array<{
    itemKey: string;
    chance: number;
    minQuantity: number;
    maxQuantity: number;
  }>;
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

const mobItemDefinitions = [
  {
    key: 'rabbit-fur',
    name: 'Królicze futro',
    description: 'Miękkie futro spaczonego królika.',
    stackLimit: 50,
    icon: '◌',
    sellPriceSilver: 5,
  },
  {
    key: 'rabbit-foot',
    name: 'Królicza łapka',
    description: 'Rzadkie trofeum z Królika Pomiotu.',
    stackLimit: 20,
    icon: '♧',
    sellPriceSilver: 22,
  },
  {
    key: 'scorpion-chitin',
    name: 'Chityna skorpiona',
    description: 'Twarda płyta pancerza Skorpiona Kata.',
    stackLimit: 50,
    icon: '⬡',
    sellPriceSilver: 14,
  },
  {
    key: 'scorpion-stinger',
    name: 'Żądło skorpiona',
    description: 'Ostre żądło przydatne w rzemiośle.',
    stackLimit: 20,
    icon: '⌁',
    sellPriceSilver: 44,
  },
  {
    key: 'venom-sac',
    name: 'Woreczek jadowy',
    description: 'Rzadki gruczoł jadowy Skorpiona Kata.',
    stackLimit: 10,
    icon: '◆',
    sellPriceSilver: 90,
  },
] as const;

const mobDefinitions: MobSeedDefinition[] = [
  {
    key: 'spawn-rabbit',
    name: 'Królik Pomiot',
    mapKey: 'greenfields',
    level: 2,
    outfitKey: 'mob-spawn-rabbit',
    spawnPoints: [
      { x: 9, y: 8 },
      { x: 12, y: 10 },
      { x: 18, y: 12 },
      { x: 22, y: 8 },
      { x: 24, y: 15 },
      { x: 14, y: 17 },
      { x: 7, y: 15 },
    ],
    respawnMs: 15_000,
    stats: {
      rank: 'SPAWN',
      characterClass: 'ARCHER',
      experience: 28,
      maxHp: 72,
      maxEnergy: 0,
      strength: 9,
      agility: 12,
      intelligence: 1,
      armor: 3,
    },
    lootTable: [
      { itemKey: 'rabbit-fur', chance: 0.65, minQuantity: 1, maxQuantity: 2 },
      { itemKey: 'rabbit-foot', chance: 0.12, minQuantity: 1, maxQuantity: 1 },
      { itemKey: 'minor-health-potion', chance: 0.08, minQuantity: 1, maxQuantity: 1 },
    ],
  },
  {
    key: 'executioner-scorpion',
    name: 'Skorpion Kat',
    mapKey: 'crystal-cave',
    level: 7,
    outfitKey: 'mob-executioner-scorpion',
    spawnPoints: [
      { x: 8, y: 7 },
      { x: 13, y: 11 },
      { x: 19, y: 9 },
      { x: 22, y: 14 },
      { x: 16, y: 17 },
      { x: 9, y: 16 },
      { x: 23, y: 6 },
    ],
    respawnMs: 30_000,
    stats: {
      rank: 'EXECUTIONER',
      characterClass: 'WARRIOR',
      experience: 145,
      maxHp: 310,
      maxEnergy: 0,
      strength: 31,
      agility: 18,
      intelligence: 3,
      armor: 17,
    },
    lootTable: [
      { itemKey: 'scorpion-chitin', chance: 0.72, minQuantity: 1, maxQuantity: 3 },
      { itemKey: 'scorpion-stinger', chance: 0.24, minQuantity: 1, maxQuantity: 1 },
      { itemKey: 'venom-sac', chance: 0.09, minQuantity: 1, maxQuantity: 1 },
      { itemKey: 'minor-health-potion', chance: 0.06, minQuantity: 1, maxQuantity: 2 },
    ],
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

function isInside(map: PreparedMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.tiledMap.width && y < map.tiledMap.height;
}

function findNearestMobTile(
  map: PreparedMap,
  requested: { x: number; y: number },
  reserved: Set<string>,
): { x: number; y: number } {
  const blocked = new Set(map.portals.map((portal) => `${portal.sourceX},${portal.sourceY}`));
  blocked.add(`${map.spawnX},${map.spawnY}`);
  if (map.key === 'greenfields') blocked.add('16,6');

  const queue = [
    {
      x: Math.min(Math.max(requested.x, 0), map.tiledMap.width - 1),
      y: Math.min(Math.max(requested.y, 0), map.tiledMap.height - 1),
    },
  ];
  const visited = new Set<string>();
  const deltas = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ];

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    const key = `${current.x},${current.y}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const collision = map.collision[current.y * map.tiledMap.width + current.x] === 1;
    if (isInside(map, current.x, current.y) && !collision && !blocked.has(key) && !reserved.has(key)) {
      return current;
    }
    for (const delta of deltas) {
      const next = { x: current.x + delta.x, y: current.y + delta.y };
      if (isInside(map, next.x, next.y) && !visited.has(`${next.x},${next.y}`)) queue.push(next);
    }
  }

  throw new Error(`Map ${map.key} has no free walkable tile for mob ${requested.x},${requested.y}.`);
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
        sourceInside && source.collision[portal.sourceY * source.tiledMap.width + portal.sourceX] === 1;
      const destinationBlocked =
        destinationInside &&
        destination.collision[portal.targetY * destination.tiledMap.width + portal.targetX] === 1;
      if (!sourceInside || sourceBlocked || !destinationInside || destinationBlocked)
        throw new Error(`Portal on ${source.key} has an invalid source or target tile.`);
    }
  }

  const greenfields = mapsByKey.get('greenfields');
  if (!greenfields || greenfields.collision[6 * greenfields.tiledMap.width + 16] === 1)
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

    for (const item of mobItemDefinitions) {
      const metadata = {
        category: 'MATERIAL',
        rarity: 'COMMON',
        icon: item.icon,
        buyPriceSilver: 0,
        sellPriceSilver: item.sellPriceSilver,
        sellable: true,
      };
      await transaction.itemDefinition.upsert({
        where: { key: item.key },
        create: {
          key: item.key,
          name: item.name,
          description: item.description,
          stackLimit: item.stackLimit,
          metadata,
        },
        update: {
          name: item.name,
          description: item.description,
          stackLimit: item.stackLimit,
          metadata,
        },
      });
    }

    const preparedByKey = new Map(preparedMaps.map((map) => [map.key, map]));
    const reservedByMap = new Map<string, Set<string>>();
    const expectedMobKeysByMap = new Map<string, string[]>();
    for (const definition of mobDefinitions) {
      const map = preparedByKey.get(definition.mapKey);
      const mapId = mapIds.get(definition.mapKey);
      if (!map || !mapId) throw new Error(`Missing seeded map ${definition.mapKey}.`);
      const reserved = reservedByMap.get(definition.mapKey) ?? new Set<string>();
      reservedByMap.set(definition.mapKey, reserved);
      const expectedKeys = expectedMobKeysByMap.get(mapId) ?? [];
      expectedMobKeysByMap.set(mapId, expectedKeys);

      for (const [index, requested] of definition.spawnPoints.entries()) {
        const position = findNearestMobTile(map, requested, reserved);
        reserved.add(`${position.x},${position.y}`);
        const key = `${definition.key}-${index + 1}`;
        expectedKeys.push(key);
        await transaction.mobDefinition.upsert({
          where: { mapId_key: { mapId, key } },
          create: {
            mapId,
            key,
            name: definition.name,
            x: position.x,
            y: position.y,
            level: definition.level,
            outfitKey: definition.outfitKey,
            stats: definition.stats as Prisma.InputJsonValue,
            lootTable: definition.lootTable as Prisma.InputJsonValue,
            respawnMs: definition.respawnMs,
          },
          update: {
            name: definition.name,
            x: position.x,
            y: position.y,
            level: definition.level,
            outfitKey: definition.outfitKey,
            stats: definition.stats as Prisma.InputJsonValue,
            lootTable: definition.lootTable as Prisma.InputJsonValue,
            respawnMs: definition.respawnMs,
          },
        });
      }
    }
    for (const [mapId, expectedKeys] of expectedMobKeysByMap) {
      await transaction.mobDefinition.deleteMany({
        where: {
          mapId,
          key: { startsWith: 'spawn-rabbit-' },
          NOT: { key: { in: expectedKeys } },
        },
      });
      await transaction.mobDefinition.deleteMany({
        where: {
          mapId,
          key: { startsWith: 'executioner-scorpion-' },
          NOT: { key: { in: expectedKeys } },
        },
      });
    }

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
      mobCount: mobDefinitions.reduce((sum, definition) => sum + definition.spawnPoints.length, 0),
    };
  });

  console.log(
    `Seeded realm ${result.realmSlug} with ${result.mapCount} maps, ${result.skillCount} combat skills, ${result.mobCount} mobs, and the Borin merchant NPC.`,
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
