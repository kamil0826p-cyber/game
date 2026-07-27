import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Coordinates, ZoneType } from '../../common/domain/game.types.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { RealmService } from '../realm/realm.service.js';
import type { RuntimeMap, RuntimePortal } from './runtime-map.types.js';
import { tileKey } from './runtime-map.types.js';
import {
  compileCollisionGrid,
  extractEmbeddedPortals,
  extractMapMetadata,
  parseTiledMap,
} from './tiled-map.parser.js';
import type {
  EmbeddedPortalDefinition,
  TiledMapJson,
  TiledMapMetadata,
} from './tiled-map.types.js';

interface MapRecord {
  id: string;
  realmId: string;
  key: string;
  name: string;
  width: number;
  height: number;
  zoneType: string;
  spawnX: number;
  spawnY: number;
  tiledData: unknown;
  version: number;
}

interface CanonicalMapDefinition {
  map: RuntimeMap;
  portals: Map<string, RuntimePortal>;
  embeddedPortals: EmbeddedPortalDefinition[];
}

const canonicalMapsDirectory = resolve(process.cwd(), 'frontend', 'public', 'maps');

const canonicalVersion = (raw: string): number =>
  Number.parseInt(createHash('sha256').update(raw).digest('hex').slice(0, 8), 16);

@Injectable()
export class MapService implements OnModuleInit {
  private readonly logger = new Logger(MapService.name);
  private readonly mapsById = new Map<string, RuntimeMap>();
  private readonly mapsByKey = new Map<string, RuntimeMap>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly realmService: RealmService,
  ) {}

  async onModuleInit(): Promise<void> {
    const realm = await this.realmService.getCurrentRealm();
    const records = (await this.prisma.map.findMany({
      where: { realmId: realm.id },
    })) as unknown as MapRecord[];

    if (records.length === 0) {
      throw new GameError(GAME_ERROR_CODES.REALM_UNAVAILABLE, 'errors.realm.unavailable', {
        reason: 'The realm has no maps.',
      });
    }

    this.mapsById.clear();
    this.mapsByKey.clear();

    const definitions = await Promise.all(records.map((record) => this.loadCanonicalMap(record)));
    for (const definition of definitions) {
      if (this.mapsById.has(definition.map.id) || this.mapsByKey.has(definition.map.key)) {
        throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', {
          reason: `Duplicate canonical map ${definition.map.key}.`,
        });
      }
      this.mapsById.set(definition.map.id, definition.map);
      this.mapsByKey.set(definition.map.key, definition.map);
    }

    for (const definition of definitions) {
      this.attachEmbeddedPortals(definition);
    }

    this.validatePortalDestinations();
    this.logger.log(
      `Compiled ${definitions.length} canonical map files for realm ${realm.slug}. ` +
        'Runtime collision and portals no longer depend on stale seeded Tiled JSON.',
    );
  }

  async getMap(mapId: string): Promise<RuntimeMap> {
    const cached = this.mapsById.get(mapId);
    if (cached) {
      return cached;
    }
    throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', {
      reason: `Map ${mapId} is not part of the initialized canonical map set.`,
    });
  }

  async getMapByKey(mapKey: string): Promise<RuntimeMap> {
    const cached = this.mapsByKey.get(mapKey);
    if (cached) {
      return cached;
    }
    throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', {
      reason: `Map ${mapKey} is not part of the initialized canonical map set.`,
    });
  }

  isInside(map: RuntimeMap, x: number, y: number): boolean {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      y >= 0 &&
      x < map.width &&
      y < map.height
    );
  }

  isCollision(map: RuntimeMap, x: number, y: number): boolean {
    if (!this.isInside(map, x, y)) {
      return true;
    }
    return map.collision[y * map.width + x] === 1;
  }

  getPortalAt(map: RuntimeMap, x: number, y: number): RuntimePortal | undefined {
    return map.portalsByTile.get(tileKey(x, y));
  }

  findNearestWalkable(
    map: RuntimeMap,
    requested: Coordinates,
    isDynamicallyBlocked: (x: number, y: number) => boolean = () => false,
  ): Coordinates {
    if (
      this.isInside(map, requested.x, requested.y) &&
      !this.isCollision(map, requested.x, requested.y) &&
      !isDynamicallyBlocked(requested.x, requested.y)
    ) {
      return requested;
    }

    const queue: Coordinates[] = [
      {
        x: Math.min(Math.max(requested.x, 0), map.width - 1),
        y: Math.min(Math.max(requested.y, 0), map.height - 1),
      },
    ];
    const visited = new Set<string>();
    const deltas = [
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
    ];

    let cursor = 0;
    while (cursor < queue.length) {
      const current = queue[cursor]!;
      cursor += 1;
      const key = tileKey(current.x, current.y);
      if (visited.has(key)) {
        continue;
      }
      visited.add(key);

      if (
        this.isInside(map, current.x, current.y) &&
        !this.isCollision(map, current.x, current.y) &&
        !isDynamicallyBlocked(current.x, current.y)
      ) {
        return current;
      }

      for (const delta of deltas) {
        const next = { x: current.x + delta.x, y: current.y + delta.y };
        if (this.isInside(map, next.x, next.y) && !visited.has(tileKey(next.x, next.y))) {
          queue.push(next);
        }
      }
    }

    throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', {
      reason: `Map ${map.key} has no walkable tile.`,
    });
  }

  private async loadCanonicalMap(record: MapRecord): Promise<CanonicalMapDefinition> {
    if (!/^[a-z0-9-]+$/.test(record.key)) {
      throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', {
        reason: `Map key ${record.key} cannot be resolved as a canonical file name.`,
      });
    }

    const filePath = resolve(canonicalMapsDirectory, `${record.key}.json`);
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (error: unknown) {
      throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', {
        reason: `Canonical map file is missing for ${record.key}: ${error instanceof Error ? error.message : 'read failed'}.`,
      });
    }

    let tiledData: TiledMapJson;
    try {
      tiledData = parseTiledMap(JSON.parse(raw) as unknown);
    } catch (error: unknown) {
      if (error instanceof GameError) {
        throw error;
      }
      throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', {
        reason: `Canonical map ${record.key} is not valid JSON.`,
      });
    }

    const metadata = extractMapMetadata(tiledData);
    if (metadata.key !== record.key) {
      throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', {
        reason: `Canonical map file ${record.key}.json declares key ${metadata.key}.`,
      });
    }

    const portals = new Map<string, RuntimePortal>();
    const map: RuntimeMap = {
      id: record.id,
      realmId: record.realmId,
      key: metadata.key,
      name: metadata.name,
      width: tiledData.width,
      height: tiledData.height,
      zoneType: metadata.zoneType as ZoneType,
      spawn: { x: metadata.spawnX, y: metadata.spawnY },
      version: canonicalVersion(raw),
      tiledData,
      collision: compileCollisionGrid(tiledData),
      portalsByTile: portals,
    };

    this.validateSpawn(map, metadata);
    return {
      map,
      portals,
      embeddedPortals: extractEmbeddedPortals(tiledData),
    };
  }

  private validateSpawn(map: RuntimeMap, metadata: TiledMapMetadata): void {
    if (
      !this.isInside(map, metadata.spawnX, metadata.spawnY) ||
      this.isCollision(map, metadata.spawnX, metadata.spawnY)
    ) {
      throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', {
        reason: `Map ${map.key} spawn tile is outside the map or blocked.`,
      });
    }
  }

  private attachEmbeddedPortals(definition: CanonicalMapDefinition): void {
    for (const embedded of definition.embeddedPortals) {
      const destination = this.mapsByKey.get(embedded.destinationMapKey);
      if (!destination) {
        throw new GameError(GAME_ERROR_CODES.PORTAL_INVALID, 'errors.portal.invalid', {
          reason: `Portal on ${definition.map.key} references missing map ${embedded.destinationMapKey}.`,
        });
      }

      if (
        !this.isInside(definition.map, embedded.sourceX, embedded.sourceY) ||
        this.isCollision(definition.map, embedded.sourceX, embedded.sourceY) ||
        !this.isInside(destination, embedded.targetX, embedded.targetY) ||
        this.isCollision(destination, embedded.targetX, embedded.targetY)
      ) {
        throw new GameError(GAME_ERROR_CODES.PORTAL_INVALID, 'errors.portal.invalid', {
          reason: `Portal on ${definition.map.key} has a blocked or out-of-bounds endpoint.`,
        });
      }

      const key = tileKey(embedded.sourceX, embedded.sourceY);
      if (definition.portals.has(key)) {
        throw new GameError(GAME_ERROR_CODES.PORTAL_INVALID, 'errors.portal.invalid', {
          reason: `Map ${definition.map.key} has multiple portals on ${key}.`,
        });
      }

      definition.portals.set(key, {
        id: `tiled:${definition.map.key}:${key}`,
        sourceMapId: definition.map.id,
        sourceX: embedded.sourceX,
        sourceY: embedded.sourceY,
        destinationMapId: destination.id,
        targetX: embedded.targetX,
        targetY: embedded.targetY,
      });
    }
  }

  private validatePortalDestinations(): void {
    for (const map of this.mapsById.values()) {
      for (const portal of map.portalsByTile.values()) {
        const destination = this.mapsById.get(portal.destinationMapId);
        if (
          !destination ||
          !this.isInside(destination, portal.targetX, portal.targetY) ||
          this.isCollision(destination, portal.targetX, portal.targetY)
        ) {
          throw new GameError(GAME_ERROR_CODES.PORTAL_INVALID, 'errors.portal.invalid', {
            reason: `Portal ${portal.id} has an invalid destination tile.`,
          });
        }
      }
    }
  }
}
