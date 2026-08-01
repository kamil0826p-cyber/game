import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { compileContentPackage } from '../src/foundation/content/content.canonical.js';
import { deployContentPackage } from '../src/foundation/content/content.deployment.js';
import { rollbackContentVersion } from '../src/foundation/content/content.rollback.js';
import { assertValidContentManifest } from '../src/foundation/content/content.validator.js';
import type { ContentPortalDefinition } from '../src/foundation/content/content.types.js';
import {
  extractEmbeddedPortals,
  parseTiledMap,
} from '../src/modules/maps/tiled-map.parser.js';
import { buildCurrentContentManifest } from './content/current-content.manifest.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDirectory, '..');
const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://game:game@localhost:5432/grid_mmorpg?schema=public';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const mapSources = [
  { key: 'greenfields', path: resolve(currentDirectory, 'maps', 'greenfields.json') },
  { key: 'crystal-cave', path: resolve(currentDirectory, 'maps', 'crystal-cave.json') },
] as const;
const fingerprintSources = [
  resolve(currentDirectory, 'seed.ts'),
  resolve(currentDirectory, 'seed-quests.ts'),
  resolve(repositoryRoot, 'src', 'modules', 'skills', 'skill.catalog.ts'),
  resolve(repositoryRoot, 'src', 'modules', 'items', 'item.service.ts'),
  ...mapSources.map((source) => source.path),
];

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
        throw new Error(`External tileset ${tileset.source} must be exported as JSON.`);
      }
      const external = JSON.parse(await readFile(tilesetPath, 'utf8')) as unknown;
      if (!isRecord(external)) throw new Error(`External tileset ${tileset.source} is malformed.`);
      return { ...external, firstgid: tileset.firstgid, source: tileset.source };
    }),
  );
  return { ...input, tilesets };
}

async function loadPortals(): Promise<ContentPortalDefinition[]> {
  const portals: ContentPortalDefinition[] = [];
  for (const source of mapSources) {
    const raw = JSON.parse(await readFile(source.path, 'utf8')) as unknown;
    const parsed = parseTiledMap(await resolveExternalTilesets(raw, source.path));
    for (const portal of extractEmbeddedPortals(parsed)) {
      portals.push({
        key: `${source.key}:${portal.sourceX},${portal.sourceY}`,
        sourceMapKey: source.key,
        destinationMapKey: portal.destinationMapKey,
        sourceX: portal.sourceX,
        sourceY: portal.sourceY,
        targetX: portal.targetX,
        targetY: portal.targetY,
      });
    }
  }
  return portals;
}

async function sourceFingerprints(): Promise<Record<string, string>> {
  const fingerprints: Record<string, string> = {};
  for (const path of fingerprintSources) {
    const relative = path.slice(repositoryRoot.length + 1).replaceAll('\\', '/');
    fingerprints[relative] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
  return fingerprints;
}

async function manifest() {
  const result = buildCurrentContentManifest(await loadPortals(), await sourceFingerprints());
  assertValidContentManifest(result);
  return result;
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'deploy';
  if (command.startsWith('rollback:')) {
    const hash = command.slice('rollback:'.length);
    if (!hash) throw new Error('A content hash is required for rollback.');
    await rollbackContentVersion(prisma, hash);
    console.log(`Rolled content definitions back to ${hash}. Player instances were preserved.`);
    return;
  }

  const current = await manifest();
  const compiled = compileContentPackage(current);
  if (command === 'validate') {
    console.log(`Validated content source package ${compiled.hash}.`);
    return;
  }
  if (command !== 'deploy') throw new Error(`Unknown content command ${command}.`);

  const result = await deployContentPackage(prisma, current);
  console.log(
    result.created
      ? `Activated new content version ${result.hash}.`
      : `Content version ${result.hash} is already active; deployment is an idempotent replay.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
