import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const WIDTH = 48;
const HEIGHT = 30;
const TILE = 32;

const property = (name, value) => ({
  name,
  type: typeof value === 'boolean' ? 'bool' : Number.isInteger(value) ? 'int' : 'string',
  value,
});
const properties = (values) => Object.entries(values).map(([name, value]) => property(name, value));
const index = (x, y) => y * WIDTH + x;
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
  nextlayerid: 92,
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

const random = (seed) => {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
};

const generateGreenfields = () => {
  const ground = Array(WIDTH * HEIGHT).fill(1);
  const paths = Array(WIDTH * HEIGHT).fill(0);
  const trunks = Array(WIDTH * HEIGHT).fill(0);
  const canopies = Array(WIDTH * HEIGHT).fill(0);

  for (let y = 1; y < HEIGHT - 1; y += 1) for (const x of [23, 24]) paths[index(x, y)] = 2;
  for (let x = 1; x < WIDTH - 1; x += 1) for (const y of [14, 15]) paths[index(x, y)] = 2;
  for (let x = 5; x <= 18; x += 1) paths[index(x, 7)] = 2;
  for (let y = 7; y <= 14; y += 1) paths[index(18, y)] = 2;
  for (let x = 29; x <= 42; x += 1) paths[index(x, 22)] = 2;
  for (let y = 15; y <= 22; y += 1) paths[index(29, y)] = 2;

  const reserved = new Set(['9,7', '7,5', '46,15', '45,15']);
  const treePositions = [];
  const addTree = (x, y) => {
    if (paths[index(x, y)] !== 0 || reserved.has(`${x},${y}`) || trunks[index(x, y)] !== 0) return;
    trunks[index(x, y)] = 3;
    canopies[index(x, y - 1)] = 4;
    treePositions.push([x, y]);
  };
  const rng = random(8026);
  for (let y = 3; y < HEIGHT - 3; y += 1) {
    for (let x = 3; x < WIDTH - 3; x += 1) if (rng() < 0.075) addTree(x, y);
  }
  for (const [x, y] of [[4, 4], [6, 4], [13, 4], [16, 5], [33, 4], [36, 5], [40, 7], [5, 20], [9, 23], [15, 21], [35, 20], [40, 24]]) addTree(x, y);

  const collisions = [
    ...borderCollisions(),
    ...treePositions.map(([x, y], offset) => ({ id: 100 + offset, name: 'Tree trunk', type: 'collision', x: x * TILE, y: y * TILE, width: TILE, height: TILE })),
  ];
  const portal = {
    id: 500,
    name: 'East passage',
    type: 'portal',
    x: (WIDTH - 1) * TILE,
    y: 15 * TILE,
    width: TILE,
    height: TILE,
    properties: properties({ destinationMapKey: 'crystal-cave', targetX: 1, targetY: 15 }),
  };

  return root([
    layer(1, 'Ground', ground),
    layer(2, 'Paths and bridges', paths),
    layer(3, 'Tree Trunks', trunks),
    layer(4, 'Tree Canopies', canopies, 'above'),
    { id: 90, name: 'Collisions', type: 'objectgroup', visible: false, opacity: 1, objects: collisions, properties: properties({ collision: true }) },
    { id: 91, name: 'Portals', type: 'objectgroup', visible: true, opacity: 1, objects: [portal], properties: properties({ portals: true }) },
  ]);
};

const generateCrystalCave = () => {
  const ground = Array(WIDTH * HEIGHT).fill(5);
  const paths = Array(WIDTH * HEIGHT).fill(0);
  const rocks = Array(WIDTH * HEIGHT).fill(0);

  for (let x = 1; x < WIDTH - 1; x += 1) for (const y of [14, 15]) paths[index(x, y)] = 2;
  for (let y = 3; y < HEIGHT - 3; y += 1) for (const x of [10, 11]) paths[index(x, y)] = 2;
  for (let x = 11; x <= 34; x += 1) paths[index(x, 6)] = 2;
  for (let y = 6; y <= 14; y += 1) paths[index(34, y)] = 2;

  const reserved = new Set(['1,15', '2,15', '3,3']);
  const rockPositions = [];
  const addRock = (x, y) => {
    if (paths[index(x, y)] !== 0 || reserved.has(`${x},${y}`) || rocks[index(x, y)] !== 0) return;
    rocks[index(x, y)] = 6;
    rockPositions.push([x, y]);
  };
  const rng = random(4242);
  for (let y = 2; y < HEIGHT - 2; y += 1) {
    for (let x = 2; x < WIDTH - 2; x += 1) if (rng() < 0.065) addRock(x, y);
  }
  for (const [x, y] of [[5, 5], [6, 5], [7, 5], [19, 4], [21, 8], [29, 5], [38, 6], [41, 10], [5, 22], [16, 24], [31, 21], [40, 24]]) addRock(x, y);

  const collisions = [
    ...borderCollisions(),
    ...rockPositions.map(([x, y], offset) => ({ id: 100 + offset, name: 'Crystal rock', type: 'collision', x: x * TILE, y: y * TILE, width: TILE, height: TILE })),
  ];
  const portal = {
    id: 500,
    name: 'West passage',
    type: 'portal',
    x: 0,
    y: 15 * TILE,
    width: TILE,
    height: TILE,
    properties: properties({ destinationMapKey: 'greenfields', targetX: WIDTH - 2, targetY: 15 }),
  };

  return root([
    layer(1, 'Ground', ground),
    layer(2, 'Paths and bridges', paths),
    layer(3, 'Rocks', rocks),
    { id: 90, name: 'Collisions', type: 'objectgroup', visible: false, opacity: 1, objects: collisions, properties: properties({ collision: true }) },
    { id: 91, name: 'Portals', type: 'objectgroup', visible: true, opacity: 1, objects: [portal], properties: properties({ portals: true }) },
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
