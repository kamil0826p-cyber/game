import type { Coordinates } from '../../contracts/game';
import type { LoadedMapDefinition } from '../../contracts/tiled';
import { isCollisionTile, isInsideMap } from '../map/tiledMap';

interface OpenNode extends Coordinates {
  g: number;
  h: number;
  f: number;
  key: string;
}

export interface FindPathOptions {
  maxVisitedNodes?: number;
  maxPathLength?: number;
  isDynamicallyBlocked?: (x: number, y: number) => boolean;
}

const keyOf = (x: number, y: number): string => `${x},${y}`;
const manhattan = (a: Coordinates, b: Coordinates): number =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

const neighbors = (x: number, y: number): Coordinates[] => [
  { x, y: y - 1 },
  { x: x + 1, y },
  { x, y: y + 1 },
  { x: x - 1, y },
];

const popLowest = (open: OpenNode[]): OpenNode | undefined => {
  if (open.length === 0) {
    return undefined;
  }
  let bestIndex = 0;
  for (let index = 1; index < open.length; index += 1) {
    const candidate = open[index]!;
    const best = open[bestIndex]!;
    if (candidate.f < best.f || (candidate.f === best.f && candidate.h < best.h)) {
      bestIndex = index;
    }
  }
  return open.splice(bestIndex, 1)[0];
};

const reconstruct = (
  cameFrom: ReadonlyMap<string, string>,
  targetKey: string,
): Coordinates[] => {
  const reversed: Coordinates[] = [];
  let currentKey: string | undefined = targetKey;
  while (currentKey) {
    const [xPart, yPart] = currentKey.split(',');
    reversed.push({ x: Number(xPart), y: Number(yPart) });
    currentKey = cameFrom.get(currentKey);
  }
  reversed.reverse();
  return reversed.slice(1);
};

export const findPath = (
  map: LoadedMapDefinition,
  start: Coordinates,
  target: Coordinates,
  options: FindPathOptions = {},
): Coordinates[] => {
  const maxVisitedNodes = options.maxVisitedNodes ?? 4_096;
  const maxPathLength = options.maxPathLength ?? 96;

  if (
    !isInsideMap(map, start.x, start.y) ||
    !isInsideMap(map, target.x, target.y) ||
    isCollisionTile(map, target.x, target.y) ||
    options.isDynamicallyBlocked?.(target.x, target.y)
  ) {
    return [];
  }
  if (start.x === target.x && start.y === target.y) {
    return [];
  }

  const startKey = keyOf(start.x, start.y);
  const targetKey = keyOf(target.x, target.y);
  const open: OpenNode[] = [
    {
      ...start,
      g: 0,
      h: manhattan(start, target),
      f: manhattan(start, target),
      key: startKey,
    },
  ];
  const openByKey = new Map<string, OpenNode>([[startKey, open[0]!]]);
  const closed = new Set<string>();
  const cameFrom = new Map<string, string>();
  const scores = new Map<string, number>([[startKey, 0]]);
  let visited = 0;

  while (open.length > 0 && visited < maxVisitedNodes) {
    const current = popLowest(open);
    if (!current) {
      break;
    }
    openByKey.delete(current.key);
    if (closed.has(current.key)) {
      continue;
    }
    closed.add(current.key);
    visited += 1;

    if (current.key === targetKey) {
      const path = reconstruct(cameFrom, targetKey);
      return path.length <= maxPathLength ? path : [];
    }

    for (const neighbor of neighbors(current.x, current.y)) {
      const neighborKey = keyOf(neighbor.x, neighbor.y);
      if (
        closed.has(neighborKey) ||
        isCollisionTile(map, neighbor.x, neighbor.y) ||
        options.isDynamicallyBlocked?.(neighbor.x, neighbor.y)
      ) {
        continue;
      }

      const tentativeG = current.g + 1;
      if (tentativeG >= (scores.get(neighborKey) ?? Number.POSITIVE_INFINITY)) {
        continue;
      }

      cameFrom.set(neighborKey, current.key);
      scores.set(neighborKey, tentativeG);
      const h = manhattan(neighbor, target);
      const existing = openByKey.get(neighborKey);
      if (existing) {
        existing.g = tentativeG;
        existing.h = h;
        existing.f = tentativeG + h;
      } else {
        const node: OpenNode = {
          ...neighbor,
          g: tentativeG,
          h,
          f: tentativeG + h,
          key: neighborKey,
        };
        open.push(node);
        openByKey.set(neighborKey, node);
      }
    }
  }

  return [];
};
