import { describe, expect, it } from 'vitest';
import type { GameConfigService } from '../src/config/game-config.service.js';
import { GameError } from '../src/common/errors/game.error.js';
import type { MapService } from '../src/modules/maps/map.service.js';
import { PathfindingService } from '../src/modules/movement/pathfinding.service.js';
import { createRuntimeMap } from './helpers/runtime-map.js';

const mapService = {
  isInside: (map: ReturnType<typeof createRuntimeMap>, x: number, y: number) =>
    Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < map.width && y < map.height,
  isCollision: (map: ReturnType<typeof createRuntimeMap>, x: number, y: number) =>
    x < 0 || y < 0 || x >= map.width || y >= map.height || map.collision[y * map.width + x] === 1,
} as unknown as MapService;

const config = {
  values: {
    MAX_PATH_STEPS: 32,
    MAX_PATH_NODES: 256,
  },
} as unknown as GameConfigService;

describe('PathfindingService', () => {
  const service = new PathfindingService(config, mapService);

  it('finds a four-direction path around collision tiles', () => {
    const map = createRuntimeMap({
      width: 5,
      height: 5,
      blocked: [
        { x: 2, y: 1 },
        { x: 2, y: 2 },
        { x: 2, y: 3 },
      ],
    });

    const path = service.findPath(map, { x: 1, y: 2 }, { x: 3, y: 2 }, () => false);
    expect(path).toHaveLength(6);
  });

  it('rejects a dynamically blocked target', () => {
    const map = createRuntimeMap();
    expect(() =>
      service.findPath(map, { x: 1, y: 1 }, { x: 2, y: 1 }, (x, y) => x === 2 && y === 1),
    ).toThrow(GameError);
  });

  it('rejects a target outside map bounds', () => {
    const map = createRuntimeMap();
    expect(() => service.findPath(map, { x: 1, y: 1 }, { x: 100, y: 1 }, () => false)).toThrow(
      GameError,
    );
  });
});
