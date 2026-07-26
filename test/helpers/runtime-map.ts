import type { ZoneType } from '../../src/common/domain/game.types.js';
import type { RuntimeMap, RuntimePortal } from '../../src/modules/maps/runtime-map.types.js';
import { tileKey } from '../../src/modules/maps/runtime-map.types.js';

export const createRuntimeMap = (options: {
  id?: string;
  key?: string;
  width?: number;
  height?: number;
  zoneType?: ZoneType;
  blocked?: Array<{ x: number; y: number }>;
  portals?: RuntimePortal[];
} = {}): RuntimeMap => {
  const width = options.width ?? 8;
  const height = options.height ?? 8;
  const collision = new Uint8Array(width * height);
  for (const tile of options.blocked ?? []) {
    collision[tile.y * width + tile.x] = 1;
  }
  const portalsByTile = new Map<string, RuntimePortal>();
  for (const portal of options.portals ?? []) {
    portalsByTile.set(tileKey(portal.sourceX, portal.sourceY), portal);
  }

  return {
    id: options.id ?? 'map-a',
    realmId: 'realm-a',
    key: options.key ?? 'map-a',
    name: options.key ?? 'Map A',
    width,
    height,
    zoneType: options.zoneType ?? 'SAFE',
    spawn: { x: 1, y: 1 },
    version: 1,
    tiledData: {
      type: 'map',
      width,
      height,
      tilewidth: 32,
      tileheight: 32,
      layers: [],
    },
    collision,
    portalsByTile,
  };
};
