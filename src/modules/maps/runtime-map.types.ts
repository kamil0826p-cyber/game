import type { Coordinates, ZoneType } from '../../common/domain/game.types.js';
import type { TiledMapJson } from './tiled-map.types.js';

export interface RuntimePortal {
  id: string;
  sourceMapId: string;
  sourceX: number;
  sourceY: number;
  destinationMapId: string;
  targetX: number;
  targetY: number;
}

export interface RuntimeMap {
  id: string;
  realmId: string;
  key: string;
  name: string;
  width: number;
  height: number;
  zoneType: ZoneType;
  spawn: Coordinates;
  version: number;
  tiledData: TiledMapJson;
  collision: Uint8Array;
  portalsByTile: ReadonlyMap<string, RuntimePortal>;
}

export const tileKey = (x: number, y: number): string => `${x}:${y}`;
