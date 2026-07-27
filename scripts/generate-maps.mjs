import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const WIDTH = 96;
const HEIGHT = 64;
const TILE = 32;

const property = (name, value) => ({
  name,
  type: typeof value === 'boolean' ? 'bool' : Number.isInteger(value) ? 'int' : 'string',
  value,
});
const properties = (values) => Object.entries(values).map(([name, value]) => property(name, value));
const index = (x, y) => y * WIDTH + x;
const inBounds = (x, y) => x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT;
const layer = (id, name, data, renderBand = 'below') => ({
  id,
  name,
  type: 'tilelayer',
  width: WIDTH,
  height: HEIGHT,
  data,
  visible: true,
  opacity: 1,
  properties: properties({ renderBand }),
});
const objectLayer = (id, name, objects, values) => ({
  id,
  name,
  type: 'objectgroup',
  visible: name !== 'Collisions',
  opacity: 1,
  objects,
  properties: properties(values),
});
const borderCollisions = () => [
  { id: 1, name: 'North wall', type: 'collision', x: 0, y: 0, width: WIDTH * TILE, height: TILE },
  { id: 2, name: 'South wall', type: 'collision', x: 0, y: (HEIGHT - 1) * TILE, width: WIDTH * TILE, height: TILE },
  { id: 3, name: 'West wall', type: 'collision', x: 0, y: 0, width: TILE, height: HEIGHT * TILE },
  { id: 4, name: 'East wall', type: 'collision', x: (WIDTH - 1) * TILE, y: 0, width: TILE, height: HEIGHT * TILE },
];
const root = (layers) => ({
  compressionlevel: -1,
  height: HEIGHT,
  width: WIDTH,
  infinite: false,
  layers,
  nextlayerid: 100,
  nextobjectid: 1000,
  orientation: 'orthogonal',
  renderorder: 'right-down',
  tiledversion: '1.11.0',
  tileheight: TILE,
  tilewidth: TILE,
  type: 'map',
  version: '1.10',
  tilesets: [{
    firstgid: 1,
    name: 'tiled-world',
    tilewidth: TILE,
    tileheight: TILE,
    tilecount: 6,
    columns: 6,
    image: '../assets/tiles/tiled-world.svg',
    imagewidth: 192,
    imageheight: 32,
    tiles: [
      { id: 2, properties: properties({ collides: true }) },
      { id: 5, properties: properties({ collides: true }) },
    ],
  }],
});

const paintRect = (data, x1, y1, x2, y2, gid) => {
  for (let y = Math.max(0, y1); y <= Math.min(HEIGHT - 1, y2); y += 1) {
    for (let x = Math.max(0, x1); x <= Math.min(WIDTH - 1, x2); x += 1) data[index(x, y)] = gid;
  }
};
const paintHorizontal = (data, x1, x2, y, width, gid) => paintRect(data, x1, y, x2, y + width - 1, gid);
const paintVertical = (data, x, y1, y2, width, gid) => paintRect(data, x, y1, x + width - 1, y2, gid);
const hash = (x, y, seed) => {
  let value = Math.imul(x + seed, 374761393) ^ Math.imul(y + seed * 3, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return (value ^ (value >>> 16)) >>> 0;
};

const generateGreenfields = () => {
  const ground = Array(WIDTH * HEIGHT).fill(1);
  const paths = Array(WIDTH * HEIGHT).fill(0);
  const trunks = Array(WIDTH * HEIGHT).fill(0);
  const canopies = Array(WIDTH * HEIGHT).fill(0);

  paintHorizontal(paths, 1, WIDTH - 2, 31, 2, 2);
  paintVertical(paths, 47, 1, HEIGHT - 2, 2, 2);
  paintHorizontal(paths, 9, 47, 7, 2, 2);
  paintVertical(paths, 8, 4, 8, 2, 2);
  paintHorizontal(paths, 8, 20, 4, 2, 2);
  paintHorizontal(paths, 37, 59, 23, 2, 2);
  paintHorizontal(paths, 37, 59, 41, 2, 2);
  paintVertical(paths, 37, 23, 42, 2, 2);
  paintVertical(paths, 58, 23, 42, 2, 2);
  paintHorizontal(paths, 48, 77, 14, 2, 2);
  paintVertical(paths, 76, 14, 31, 2, 2);
  paintHorizontal(paths, 18, 47, 51, 2, 2);
  paintVertical(paths, 18, 32, 52, 2, 2);

  const reserved = new Set();
  const reserveRect = (x1, y1, x2, y2) => {
    for (let y = y1; y <= y2; y += 1) for (let x = x1; x <= x2; x += 1) reserved.add(`${x},${y}`);
  };
  reserveRect(2, 2, 23, 12);
  reserveRect(34, 20, 62, 44);
  reserveRect(88, 27, 95, 37);
  reserveRect(4, 28, 15, 38);
  reserveRect(78, 46, 91, 58);

  const canPlaceTree = (x, y) => {
    if (!inBounds(x, y) || !inBounds(x, y - 1) || y < 2 || y >= HEIGHT - 1) return false;
    if (reserved.has(`${x},${y}`) || reserved.has(`${x},${y - 1}`)) return false;
    if (paths[index(x, y)] !== 0 || paths[index(x, y - 1)] !== 0) return false;
    for (let yy = y - 2; yy <= y + 2; yy += 1) {
      for (let xx = x - 2; xx <= x + 2; xx += 1) {
        if (!inBounds(xx, yy)) continue;
        if (trunks[index(xx, yy)] !== 0 || canopies[index(xx, yy)] !== 0) return false;
      }
    }
    return true;
  };
  const addTree = (x, y) => {
    if (!canPlaceTree(x, y)) return;
    trunks[index(x, y)] = 3;
    canopies[index(x, y - 1)] = 4;
  };
  const forestEllipse = (cx, cy, rx, ry, seed, density = 68) => {
    for (let y = Math.max(2, cy - ry); y <= Math.min(HEIGHT - 2, cy + ry); y += 2) {
      for (let x = Math.max(2, cx - rx); x <= Math.min(WIDTH - 3, cx + rx); x += 2) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy > 1) continue;
        if (hash(x, y, seed) % 100 < density) addTree(x, y);
      }
    }
  };

  forestEllipse(24, 20, 20, 15, 11, 78);
  forestEllipse(73, 19, 19, 14, 17, 76);
  forestEllipse(26, 49, 20, 12, 23, 74);
  forestEllipse(70, 50, 22, 12, 31, 76);
  forestEllipse(8, 50, 7, 10, 37, 70);
  forestEllipse(88, 12, 7, 10, 41, 72);

  const portal = {
    id: 500,
    name: 'Eastern cave road',
    type: 'portal',
    x: (WIDTH - 1) * TILE,
    y: 32 * TILE,
    width: TILE,
    height: TILE,
    properties: properties({ destinationMapKey: 'crystal-cave', targetX: 1, targetY: 32 }),
  };

  return root([
    layer(1, 'Grassland', ground),
    layer(2, 'Road Network', paths),
    layer(3, 'Tree Trunks', trunks),
    layer(4, 'Tree Canopies', canopies, 'above'),
    objectLayer(90, 'Collisions', borderCollisions(), { collision: true }),
    objectLayer(91, 'Portals', [portal], { portals: true }),
  ]);
};

const generateCrystalCave = () => {
  const ground = Array(WIDTH * HEIGHT).fill(5);
  const paths = Array(WIDTH * HEIGHT).fill(0);
  const rocks = Array(WIDTH * HEIGHT).fill(0);
  const protectedTiles = new Set();

  const protectRect = (x1, y1, x2, y2, pathGid = 0) => {
    for (let y = Math.max(1, y1); y <= Math.min(HEIGHT - 2, y2); y += 1) {
      for (let x = Math.max(1, x1); x <= Math.min(WIDTH - 2, x2); x += 1) {
        protectedTiles.add(`${x},${y}`);
        if (pathGid !== 0) paths[index(x, y)] = pathGid;
      }
    }
  };
  const protectEllipse = (cx, cy, rx, ry) => {
    for (let y = cy - ry; y <= cy + ry; y += 1) {
      for (let x = cx - rx; x <= cx + rx; x += 1) {
        if (!inBounds(x, y)) continue;
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) protectedTiles.add(`${x},${y}`);
      }
    }
  };

  protectRect(1, 30, 94, 34, 2);
  protectRect(18, 5, 22, 32, 2);
  protectRect(46, 31, 50, 59, 2);
  protectRect(72, 14, 76, 50, 2);
  protectRect(20, 12, 48, 16, 2);
  protectRect(48, 48, 74, 52, 2);
  protectRect(74, 18, 90, 22, 2);
  protectRect(3, 3, 21, 7, 2);
  protectEllipse(20, 16, 10, 8);
  protectEllipse(48, 32, 13, 10);
  protectEllipse(74, 18, 11, 8);
  protectEllipse(74, 49, 12, 9);
  protectEllipse(8, 5, 6, 4);

  const canAddRock = (x, y) => inBounds(x, y) && x > 0 && y > 0 && x < WIDTH - 1 && y < HEIGHT - 1 && !protectedTiles.has(`${x},${y}`);
  const addRock = (x, y) => { if (canAddRock(x, y)) rocks[index(x, y)] = 6; };
  const rockEllipse = (cx, cy, rx, ry) => {
    for (let y = cy - ry; y <= cy + ry; y += 1) {
      for (let x = cx - rx; x <= cx + rx; x += 1) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) addRock(x, y);
      }
    }
  };
  const rockRing = (cx, cy, rx, ry, thickness = 2) => {
    const innerRx = Math.max(1, rx - thickness);
    const innerRy = Math.max(1, ry - thickness);
    for (let y = cy - ry; y <= cy + ry; y += 1) {
      for (let x = cx - rx; x <= cx + rx; x += 1) {
        const outer = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        const inner = ((x - cx) / innerRx) ** 2 + ((y - cy) / innerRy) ** 2;
        if (outer <= 1 && inner >= 1) addRock(x, y);
      }
    }
  };

  rockRing(20, 16, 13, 11, 3);
  rockRing(48, 32, 17, 14, 3);
  rockRing(74, 18, 14, 11, 3);
  rockRing(74, 49, 16, 12, 3);
  rockEllipse(34, 7, 9, 5);
  rockEllipse(57, 9, 8, 6);
  rockEllipse(88, 8, 6, 7);
  rockEllipse(8, 20, 7, 8);
  rockEllipse(34, 55, 10, 6);
  rockEllipse(58, 58, 8, 4);
  rockEllipse(90, 51, 5, 9);
  rockEllipse(8, 52, 6, 8);
  paintRect(rocks, 2, 58, 26, 61, 6);
  paintRect(rocks, 81, 2, 93, 5, 6);

  for (const tile of protectedTiles) {
    const [x, y] = tile.split(',').map(Number);
    rocks[index(x, y)] = 0;
  }

  const portal = {
    id: 500,
    name: 'Western cave mouth',
    type: 'portal',
    x: 0,
    y: 32 * TILE,
    width: TILE,
    height: TILE,
    properties: properties({ destinationMapKey: 'greenfields', targetX: WIDTH - 2, targetY: 32 }),
  };

  return root([
    layer(1, 'Cave Floor', ground),
    layer(2, 'Cave Trails', paths),
    layer(3, 'Rock Formations', rocks),
    objectLayer(90, 'Collisions', borderCollisions(), { collision: true }),
    objectLayer(91, 'Portals', [portal], { portals: true }),
  ]);
};

const maps = {
  greenfields: generateGreenfields(),
  'crystal-cave': generateCrystalCave(),
};

for (const [name, map] of Object.entries(maps)) {
  for (const currentLayer of map.layers) {
    if (currentLayer.type === 'tilelayer' && currentLayer.data.length !== WIDTH * HEIGHT) {
      throw new Error(`${name}/${currentLayer.name} has invalid dimensions.`);
    }
  }
  const serialized = `${JSON.stringify(map)}\n`;
  for (const directory of [resolve('prisma/maps'), resolve('frontend/public/maps')]) {
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, `${name}.json`), serialized, 'utf8');
  }
}

console.log(`Generated ${Object.keys(maps).length} maps at ${WIDTH}x${HEIGHT}.`);
