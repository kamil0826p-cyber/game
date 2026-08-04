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
const hospitalSpawn = { x: 12, y: 15 } as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

async function loadMap(fileName: string): Promise<TiledMapJson> {
  const mapPath = resolve(currentDirectory, 'maps', fileName);
  const raw = JSON.parse(await readFile(mapPath, 'utf8')) as unknown;
  if (!isRecord(raw) || !Array.isArray(raw.tilesets)) {
    throw new Error(`Map ${fileName} has malformed tilesets.`);
  }

  const tilesets = await Promise.all(
    raw.tilesets.map(async (reference) => {
      if (!isRecord(reference) || typeof reference.source !== 'string') return reference;
      const tilesetPath = resolve(dirname(mapPath), reference.source);
      if (!['.json', '.tsj'].includes(extname(tilesetPath).toLowerCase())) {
        throw new Error(`Hospital tileset ${reference.source} must be JSON .tsj.`);
      }
      const external = JSON.parse(await readFile(tilesetPath, 'utf8')) as unknown;
      if (!isRecord(external)) throw new Error(`Tileset ${reference.source} is malformed.`);
      return {
        ...external,
        firstgid: reference.firstgid,
        source: reference.source,
        resolvedSourceUrl: tilesetPath,
      };
    }),
  );
  return parseTiledMap({ ...raw, tilesets });
}

async function main(): Promise<void> {
  const tiledMap = await loadMap('hospital.json');
  const collision = compileCollisionGrid(tiledMap);
  const portals = extractEmbeddedPortals(tiledMap);
  const spawnIndex = hospitalSpawn.y * tiledMap.width + hospitalSpawn.x;
  if (
    hospitalSpawn.x >= tiledMap.width ||
    hospitalSpawn.y >= tiledMap.height ||
    collision[spawnIndex] === 1
  ) {
    throw new Error('Hospital spawn must be a walkable tile inside the map.');
  }
  if (portals.length !== 1 || portals[0]?.destinationMapKey !== 'greenfields') {
    throw new Error('Hospital must contain exactly one portal leading to Greenfields.');
  }

  await prisma.$transaction(async (transaction) => {
    const realm = await transaction.realm.findUnique({ where: { slug: realmSlug } });
    if (!realm) throw new Error(`Realm ${realmSlug} must be seeded before the hospital.`);

    const greenfields = await transaction.map.findUnique({
      where: { realmId_key: { realmId: realm.id, key: 'greenfields' } },
    });
    if (!greenfields) throw new Error('Greenfields must exist before the hospital is seeded.');

    const portal = portals[0]!;
    const greenfieldsMap = parseTiledMap(greenfields.tiledData);
    const greenfieldsCollision = compileCollisionGrid(greenfieldsMap);
    const targetIndex = portal.targetY * greenfieldsMap.width + portal.targetX;
    if (
      portal.targetX < 0 ||
      portal.targetY < 0 ||
      portal.targetX >= greenfieldsMap.width ||
      portal.targetY >= greenfieldsMap.height ||
      greenfieldsCollision[targetIndex] === 1
    ) {
      throw new Error('Hospital portal target on Greenfields must be walkable.');
    }

    const hospital = await transaction.map.upsert({
      where: { realmId_key: { realmId: realm.id, key: 'hospital' } },
      create: {
        realmId: realm.id,
        key: 'hospital',
        name: 'Mroczna Lecznica',
        width: tiledMap.width,
        height: tiledMap.height,
        zoneType: 'SAFE',
        spawnX: hospitalSpawn.x,
        spawnY: hospitalSpawn.y,
        tiledData: tiledMap as unknown as Prisma.InputJsonValue,
      },
      update: {
        name: 'Mroczna Lecznica',
        width: tiledMap.width,
        height: tiledMap.height,
        zoneType: 'SAFE',
        spawnX: hospitalSpawn.x,
        spawnY: hospitalSpawn.y,
        tiledData: tiledMap as unknown as Prisma.InputJsonValue,
        version: { increment: 1 },
      },
    });

    await transaction.portal.deleteMany({ where: { sourceMapId: hospital.id } });
    await transaction.portal.create({
      data: {
        sourceMapId: hospital.id,
        sourceX: portal.sourceX,
        sourceY: portal.sourceY,
        destinationMapId: greenfields.id,
        targetX: portal.targetX,
        targetY: portal.targetY,
        enabled: true,
      },
    });
  });

  console.log(
    `Seeded hospital map ${tiledMap.width}x${tiledMap.height}, spawn ${hospitalSpawn.x},${hospitalSpawn.y}, portal to Greenfields.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
