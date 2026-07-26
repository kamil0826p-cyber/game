import { Injectable } from '@nestjs/common';
import type { Coordinates, Direction } from '../../common/domain/game.types.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { GameConfigService } from '../../config/game-config.service.js';
import { MapService } from '../maps/map.service.js';
import type { RuntimeMap } from '../maps/runtime-map.types.js';

interface HeapNode {
  index: number;
  priority: number;
}

class MinimumHeap {
  private readonly values: HeapNode[] = [];

  get size(): number {
    return this.values.length;
  }

  push(node: HeapNode): void {
    this.values.push(node);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.values[parent]!.priority <= node.priority) {
        break;
      }
      this.values[index] = this.values[parent]!;
      index = parent;
    }
    this.values[index] = node;
  }

  pop(): HeapNode | undefined {
    if (this.values.length === 0) {
      return undefined;
    }
    const root = this.values[0]!;
    const tail = this.values.pop()!;
    if (this.values.length === 0) {
      return root;
    }

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.values.length) {
        break;
      }
      const smaller =
        right < this.values.length && this.values[right]!.priority < this.values[left]!.priority
          ? right
          : left;
      if (this.values[smaller]!.priority >= tail.priority) {
        break;
      }
      this.values[index] = this.values[smaller]!;
      index = smaller;
    }
    this.values[index] = tail;
    return root;
  }
}

const DIRECTIONS: ReadonlyArray<{ direction: Direction; dx: number; dy: number; code: number }> = [
  { direction: 'NORTH', dx: 0, dy: -1, code: 0 },
  { direction: 'EAST', dx: 1, dy: 0, code: 1 },
  { direction: 'SOUTH', dx: 0, dy: 1, code: 2 },
  { direction: 'WEST', dx: -1, dy: 0, code: 3 },
];

const DIRECTION_BY_CODE: readonly Direction[] = ['NORTH', 'EAST', 'SOUTH', 'WEST'];

@Injectable()
export class PathfindingService {
  constructor(
    private readonly config: GameConfigService,
    private readonly mapService: MapService,
  ) {}

  findPath(
    map: RuntimeMap,
    start: Coordinates,
    target: Coordinates,
    isDynamicallyBlocked: (x: number, y: number) => boolean,
  ): Direction[] {
    if (!this.mapService.isInside(map, target.x, target.y)) {
      throw new GameError(
        GAME_ERROR_CODES.MOVE_OUT_OF_BOUNDS,
        'errors.movement.outOfBounds',
      );
    }
    if (this.mapService.isCollision(map, target.x, target.y) || isDynamicallyBlocked(target.x, target.y)) {
      throw new GameError(GAME_ERROR_CODES.MOVE_NO_PATH, 'errors.movement.noPath');
    }

    const directDistance = Math.abs(start.x - target.x) + Math.abs(start.y - target.y);
    if (directDistance > this.config.values.MAX_PATH_STEPS) {
      throw new GameError(
        GAME_ERROR_CODES.MOVE_PATH_TOO_LONG,
        'errors.movement.pathTooLong',
      );
    }
    if (start.x === target.x && start.y === target.y) {
      return [];
    }

    const tileCount = map.width * map.height;
    const startIndex = start.y * map.width + start.x;
    const targetIndex = target.y * map.width + target.x;
    const gScore = new Int32Array(tileCount);
    const cameFrom = new Int32Array(tileCount);
    const cameDirection = new Int8Array(tileCount);
    const closed = new Uint8Array(tileCount);
    gScore.fill(-1);
    cameFrom.fill(-1);
    cameDirection.fill(-1);

    const heap = new MinimumHeap();
    gScore[startIndex] = 0;
    heap.push({ index: startIndex, priority: directDistance });
    let expanded = 0;

    while (heap.size > 0) {
      const current = heap.pop()!;
      if (closed[current.index] === 1) {
        continue;
      }
      closed[current.index] = 1;
      expanded += 1;
      if (expanded > this.config.values.MAX_PATH_NODES) {
        throw new GameError(
          GAME_ERROR_CODES.MOVE_PATH_SEARCH_LIMIT,
          'errors.movement.searchLimit',
        );
      }
      if (current.index === targetIndex) {
        return this.reconstructPath(cameFrom, cameDirection, startIndex, targetIndex);
      }

      const currentX = current.index % map.width;
      const currentY = Math.floor(current.index / map.width);
      const currentScore = gScore[current.index]!;

      for (const step of DIRECTIONS) {
        const nextX = currentX + step.dx;
        const nextY = currentY + step.dy;
        if (
          !this.mapService.isInside(map, nextX, nextY) ||
          this.mapService.isCollision(map, nextX, nextY) ||
          isDynamicallyBlocked(nextX, nextY)
        ) {
          continue;
        }

        const nextIndex = nextY * map.width + nextX;
        if (closed[nextIndex] === 1) {
          continue;
        }
        const tentativeScore = currentScore + 1;
        if (gScore[nextIndex] !== -1 && tentativeScore >= gScore[nextIndex]!) {
          continue;
        }

        gScore[nextIndex] = tentativeScore;
        cameFrom[nextIndex] = current.index;
        cameDirection[nextIndex] = step.code;
        const heuristic = Math.abs(nextX - target.x) + Math.abs(nextY - target.y);
        heap.push({ index: nextIndex, priority: tentativeScore + heuristic });
      }
    }

    throw new GameError(GAME_ERROR_CODES.MOVE_NO_PATH, 'errors.movement.noPath');
  }

  private reconstructPath(
    cameFrom: Int32Array,
    cameDirection: Int8Array,
    startIndex: number,
    targetIndex: number,
  ): Direction[] {
    const reversed: Direction[] = [];
    let current = targetIndex;
    while (current !== startIndex) {
      const directionCode = cameDirection[current];
      const previous = cameFrom[current];
      if (directionCode < 0 || previous < 0) {
        throw new GameError(GAME_ERROR_CODES.MOVE_NO_PATH, 'errors.movement.noPath');
      }
      reversed.push(DIRECTION_BY_CODE[directionCode]!);
      current = previous;
    }
    reversed.reverse();
    if (reversed.length > this.config.values.MAX_PATH_STEPS) {
      throw new GameError(
        GAME_ERROR_CODES.MOVE_PATH_TOO_LONG,
        'errors.movement.pathTooLong',
      );
    }
    return reversed;
  }
}
