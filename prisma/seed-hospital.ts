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
import type { TiledMapJson } from '../src/modules/maps/tiled-map.types.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://game:game@localhost:5432/grid_mmorpg?schema=public';
const realmSlug = process.env.GAME_REALM_SLUG ?? 'world-1';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const MAP_KEY = 'ashen-infirmary';
const MAP_NAME = 'Lazaret Popielnych';
const MAP_FILE = 'ashen-infirmary.json';
const SPAWN = { x: 11, y: 11 } as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

async function resolveExternalTilesets(input: unknown, mapPath: string): Promise<unknown> {
  if (!isRecord(input) || !Array.isArray(input.tilesets)) return input;
  const tilesets = await Promise.all(
    input.tilesets.map(async (tileset) => {
      if (!isRecord(tileset) || typeof tileset.source !== 'string' || !tileset.source.trim()) {
        return tileset;
      }
      const tilesetPath = resolve(dirname(mapPath), tileset.source);
      if (!['.json', '.tsj'].includes(extname(tilesetPath).toLowerCase())) {
        throw new Error(
          `External tileset ${tileset.source} must be exported as Tiled JSON (.tsj), not TSX/XML.`,
        );
      }
      const external = JSON.parse(await readFile(tilesetPath, 'utf8')) as unknown;
      if (!isRecord(external)) {
        throw new Error(`External tileset ${tileset.source} is malformed.`);
      }
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

async function loadMap(): Promise<TiledMapJson> {
  const mapPath = resolve(currentDirectory, 'maps', MAP_FILE);
  const raw = JSON.parse(await readFile(mapPath, 'utf8')) as unknown;
  return parseTiledMap(await resolveExternalTilesets(raw, mapPath));
}

async function main(): Promise<void> {
  const tiledMap = await loadMap();
  const collision = compileCollisionGrid(tiledMap);
  const spawnIndex = SPAWN.y * tiledMap.width + SPAWN.x;
  if (
    SPAWN.x < 0 ||
    SPAWN.y < 0 ||
    SPAWN.x >= tiledMap.width ||
    SPAWN.y >= tiledMap.height ||
    collision[spawnIndex] === 1
  ) {
    throw new Error(`${MAP_NAME} has an invalid recovery spawn tile.`);
  }

  const portals = extractEmbeddedPortals(tiledMap);
  if (portals.length !== 1 || portals[0]?.destinationMapKey !== 'greenfields') {
    throw new Error(`${MAP_NAME} must contain exactly one portal leading to greenfields.`);
  }

  const result = await prisma.$transaction(async (transaction) => {
    const realm = await transaction.realm.findUnique({ where: { slug: realmSlug } });
    if (!realm) throw new Error(`Realm ${realmSlug} must be seeded before ${MAP_NAME}.`);

    const destinationMaps = new Map<string, { id: string; width: number; height: number; tiledData: unknown }>();
    for (const portal of portals) {
      const destination = await transaction.map.findUnique({
        where: { realmId_key: { realmId: realm.id, key: portal.destinationMapKey } },
        select: { id: true, width: true, height: true, tiledData: true },
      });
      if (!destination) {
        throw new Error(`Portal references missing map ${portal.destinationMapKey}.`);
      }
      destinationMaps.set(portal.destinationMapKey, destination);
      const destinationCollision = compileCollisionGrid(parseTiledMap(destination.tiledData));
      const targetInside =
        portal.targetX >= 0 &&
        portal.targetY >= 0 &&
        portal.targetX < destination.width &&
        portal.targetY < destination.height;
      if (
        !targetInside ||
        destinationCollision[portal.targetY * destination.width + portal.targetX] === 1
      ) {
        throw new Error(`Portal target on ${portal.destinationMapKey} is blocked or outside the map.`);
      }
    }

    const hospital = await transaction.map.upsert({
      where: { realmId_key: { realmId: realm.id, key: MAP_KEY } },
      create: {
        realmId: realm.id,
        key: MAP_KEY,
        name: MAP_NAME,
        width: tiledMap.width,
        height: tiledMap.height,
        zoneType: 'SAFE',
        spawnX: SPAWN.x,
        spawnY: SPAWN.y,
        tiledData: tiledMap as unknown as Prisma.InputJsonValue,
      },
      update: {
        name: MAP_NAME,
        width: tiledMap.width,
        height: tiledMap.height,
        zoneType: 'SAFE',
        spawnX: SPAWN.x,
        spawnY: SPAWN.y,
        tiledData: tiledMap as unknown as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });

    await transaction.portal.deleteMany({ where: { sourceMapId: hospital.id } });
    await transaction.portal.createMany({
      data: portals.map((portal) => ({
        sourceMapId: hospital.id,
        sourceX: portal.sourceX,
        sourceY: portal.sourceY,
        destinationMapId: destinationMaps.get(portal.destinationMapKey)!.id,
        targetX: portal.targetX,
        targetY: portal.targetY,
        enabled: true,
      })),
    });

    return { map: hospital, portals: portals.length };
  });

  console.log(
    `Seeded ${result.map.name} (${result.map.key}) at ${result.map.width}x${result.map.height} with ${result.portals} portal.`,
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
