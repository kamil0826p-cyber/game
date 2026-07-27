import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../src/generated/prisma/client.ts';
import {
  compileCollisionGrid,
  extractEmbeddedPortals,
  extractMapMetadata,
  extractTiledPoint,
  parseTiledMap,
} from '../src/modules/maps/tiled-map.parser.js';
import type {
  EmbeddedPortalDefinition,
  TiledMapJson,
  TiledMapMetadata,
} from '../src/modules/maps/tiled-map.types.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const mapsDirectory = resolve(currentDirectory, '..', 'frontend', 'public', 'maps');
const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://game:game@localhost:5432/grid_mmorpg?schema=public';
const realmSlug = process.env.GAME_REALM_SLUG ?? 'world-1';
const realmName = process.env.GAME_REALM_NAME ?? 'World 1';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

interface PreparedMap extends TiledMapMetadata {
  fileName: string;
  tiledMap: TiledMapJson;
  collision: Uint8Array;
  portals: EmbeddedPortalDefinition[];
}

const merchantStock = [
  'traveler-sword',
  'apprentice-staff',
  'field-bow',
  'minor-health-potion',
  'field-rations',
] as const;

async function loadMap(fileName: string): Promise<PreparedMap> {
  const raw = await readFile(resolve(mapsDirectory, fileName), 'utf8');
  const tiledMap = parseTiledMap(JSON.parse(raw) as unknown);
  const metadata = extractMapMetadata(tiledMap);
  const collision = compileCollisionGrid(tiledMap);
  const spawnInside =
    metadata.spawnX >= 0 &&
    metadata.spawnY >= 0 &&
    metadata.spawnX < tiledMap.width &&
    metadata.spawnY < tiledMap.height;
  const spawnIndex = metadata.spawnY * tiledMap.width + metadata.spawnX;
  if (!spawnInside || collision[spawnIndex] === 1) {
    throw new Error(`Map ${metadata.key} has an invalid Tiled spawn tile.`);
  }
  return {
    ...metadata,
    fileName,
    tiledMap,
    collision,
    portals: extractEmbeddedPortals(tiledMap),
  };
}

async function prepareMaps(): Promise<PreparedMap[]> {
  const entries = await readdir(mapsDirectory, { withFileTypes: true });
  const mapFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();
  if (mapFiles.length === 0) {
    throw new Error(`No Tiled JSON maps found in ${mapsDirectory}.`);
  }

  const prepared = await Promise.all(mapFiles.map(loadMap));
  const mapsByKey = new Map(prepared.map((definition) => [definition.key, definition]));
  if (mapsByKey.size !== prepared.length) {
    throw new Error('Tiled map property key values must be unique.');
  }

  const defaults = prepared.filter((definition) => definition.isDefault);
  if (defaults.length !== 1) {
    throw new Error('Exactly one Tiled map must define the boolean property default=true.');
  }

  for (const source of prepared) {
    for (const portal of source.portals) {
      const destination = mapsByKey.get(portal.destinationMapKey);
      if (!destination) {
        throw new Error(
          `Portal on ${source.key} references unknown map ${portal.destinationMapKey}.`,
        );
      }
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
        destination.collision[
          portal.targetY * destination.tiledMap.width + portal.targetX
        ] === 1;
      if (!sourceInside || sourceBlocked || !destinationInside || destinationBlocked) {
        throw new Error(`Portal on ${source.key} has an invalid source or target tile.`);
      }
    }
  }

  const defaultMap = defaults[0]!;
  const merchant = extractTiledPoint(defaultMap.tiledMap, 'quartermaster');
  const merchantX = merchant.x;
  const merchantY = merchant.y;
  const merchantInside =
    merchantX >= 0 &&
    merchantY >= 0 &&
    merchantX < defaultMap.tiledMap.width &&
    merchantY < defaultMap.tiledMap.height;
  if (
    !merchantInside ||
    defaultMap.collision[merchantY * defaultMap.tiledMap.width + merchantX] === 1
  ) {
    throw new Error('Borin merchant must be placed on a walkable default-map tile.');
  }
  return prepared;
}

async function main(): Promise<void> {
  const preparedMaps = await prepareMaps();
  const defaultDefinition = preparedMaps.find((definition) => definition.isDefault)!;
  const merchant = extractTiledPoint(defaultDefinition.tiledMap, 'quartermaster');
  const merchantX = merchant.x;
  const merchantY = merchant.y;
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

    const defaultMapId = mapIds.get(defaultDefinition.key)!;

    await transaction.npcDefinition.upsert({
      where: { mapId_key: { mapId: defaultMapId, key: 'quartermaster' } },
      create: {
        mapId: defaultMapId,
        key: 'quartermaster',
        name: 'Borin Żelazna Dłoń',
        x: merchantX,
        y: merchantY,
        outfitKey: 'npc-warrior-merchant',
        dialogue: {
          type: 'MERCHANT',
          merchant: { itemKeys: merchantStock, interactionRadius: 2, infiniteStock: true },
        },
      },
      update: {
        name: 'Borin Żelazna Dłoń',
        x: merchantX,
        y: merchantY,
        outfitKey: 'npc-warrior-merchant',
        dialogue: {
          type: 'MERCHANT',
          merchant: { itemKeys: merchantStock, interactionRadius: 2, infiniteStock: true },
        },
      },
    });

    await transaction.realm.update({ where: { id: realm.id }, data: { defaultMapId } });
    return { realmSlug: realm.slug, mapCount: preparedMaps.length };
  });

  console.log(
    `Seeded realm ${result.realmSlug} with ${result.mapCount} Tiled maps and the Borin merchant NPC.`,
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
