import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Coordinates, ZoneType } from '../../common/domain/game.types.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { RealmService } from '../realm/realm.service.js';
import type { RuntimeMap, RuntimePortal } from './runtime-map.types.js';
import { tileKey } from './runtime-map.types.js';
import { compileCollisionGrid, parseTiledMap } from './tiled-map.parser.js';

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
  sourcePortals: Array<{
    id: string;
    sourceMapId: string;
    sourceX: number;
    sourceY: number;
    destinationMapId: string;
    targetX: number;
    targetY: number;
    enabled: boolean;
  }>;
}

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
    const records = await this.prisma.map.findMany({
      where: { realmId: realm.id },
      include: { sourcePortals: true },
    });

    if (records.length === 0) {
      throw new GameError(GAME_ERROR_CODES.REALM_UNAVAILABLE, 'errors.realm.unavailable', {
        reason: 'The realm has no maps.',
      });
    }

    for (const record of records) {
      const runtimeMap = this.compileMap(record as unknown as MapRecord);
      this.mapsById.set(runtimeMap.id, runtimeMap);
      this.mapsByKey.set(runtimeMap.key, runtimeMap);
    }

    this.validatePortalDestinations();
    this.logger.log(`Compiled ${records.length} map definitions for realm ${realm.slug}.`);
  }

  async getMap(mapId: string): Promise<RuntimeMap> {
    const cached = this.mapsById.get(mapId);
    if (cached) {
      return cached;
    }

    const realm = await this.realmService.getCurrentRealm();
    const record = await this.prisma.map.findFirst({
      where: { id: mapId, realmId: realm.id },
      include: { sourcePortals: true },
    });
    if (!record) {
      throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid');
    }

    const runtimeMap = this.compileMap(record as unknown as MapRecord);
    this.mapsById.set(runtimeMap.id, runtimeMap);
    this.mapsByKey.set(runtimeMap.key, runtimeMap);
    return runtimeMap;
  }

  async getMapByKey(mapKey: string): Promise<RuntimeMap> {
    const cached = this.mapsByKey.get(mapKey);
    if (cached) {
      return cached;
    }

    const realm = await this.realmService.getCurrentRealm();
    const record = await this.prisma.map.findUnique({
      where: { realmId_key: { realmId: realm.id, key: mapKey } },
      include: { sourcePortals: true },
    });
    if (!record) {
      throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid');
    }

    const runtimeMap = this.compileMap(record as unknown as MapRecord);
    this.mapsById.set(runtimeMap.id, runtimeMap);
    this.mapsByKey.set(runtimeMap.key, runtimeMap);
    return runtimeMap;
  }

  isInside(map: RuntimeMap, x: number, y: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < map.width && y < map.height;
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

  private compileMap(record: MapRecord): RuntimeMap {
    const tiledData = parseTiledMap(record.tiledData);
    if (tiledData.width !== record.width || tiledData.height !== record.height) {
      throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', {
        reason: `Map ${record.key} database dimensions do not match the Tiled JSON.`,
      });
    }

    const portals = new Map<string, RuntimePortal>();
    for (const portal of record.sourcePortals) {
      if (!portal.enabled) {
        continue;
      }
      portals.set(tileKey(portal.sourceX, portal.sourceY), {
        id: portal.id,
        sourceMapId: portal.sourceMapId,
        sourceX: portal.sourceX,
        sourceY: portal.sourceY,
        destinationMapId: portal.destinationMapId,
        targetX: portal.targetX,
        targetY: portal.targetY,
      });
    }

    const map: RuntimeMap = {
      id: record.id,
      realmId: record.realmId,
      key: record.key,
      name: record.name,
      width: record.width,
      height: record.height,
      zoneType: record.zoneType as ZoneType,
      spawn: { x: record.spawnX, y: record.spawnY },
      version: record.version,
      tiledData,
      collision: compileCollisionGrid(tiledData),
      portalsByTile: portals,
    };

    if (this.isCollision(map, map.spawn.x, map.spawn.y)) {
      throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', {
        reason: `Map ${record.key} spawn tile is blocked.`,
      });
    }

    for (const portal of portals.values()) {
      if (!this.isInside(map, portal.sourceX, portal.sourceY) || this.isCollision(map, portal.sourceX, portal.sourceY)) {
        throw new GameError(GAME_ERROR_CODES.PORTAL_INVALID, 'errors.portal.invalid', {
          reason: `Portal ${portal.id} has an invalid source tile.`,
        });
      }
    }

    return map;
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
