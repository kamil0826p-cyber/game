import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const assetsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');
const tilesetPath = resolve(assetsRoot, 'tiles', 'tiled-world.svg');

const tileset = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="32" viewBox="0 0 192 32" shape-rendering="crispEdges">
  <rect width="32" height="32" fill="#3f7a43"/><path d="M0 8h32M0 24h32M8 0v32M24 0v32" stroke="#4b8750" opacity=".35"/>
  <rect x="32" width="32" height="32" fill="#b9955e"/><path d="M32 7h32M32 23h32" stroke="#d1b27a" opacity=".6"/>
  <rect x="64" width="32" height="32" fill="none"/><ellipse cx="80" cy="29" rx="8" ry="3" fill="#152419" opacity=".38"/><path d="M75 32V0h10v32z" fill="#6b4326"/><path d="M78 32V0h3v32z" fill="#93603a" opacity=".88"/><path d="M84 15l5-5v6l-5 5zM76 11l-5-5v6l5 5z" fill="#6b4326"/>
  <rect x="96" width="32" height="32" fill="none"/><circle cx="112" cy="15" r="16" fill="#1f512c"/><circle cx="102" cy="14" r="10" fill="#347842"/><circle cx="121" cy="12" r="11" fill="#2b6a39"/><circle cx="112" cy="23" r="12" fill="#285f34"/>
  <rect x="128" width="32" height="32" fill="#29263b"/><path d="M128 8h32M128 24h32" stroke="#37334d" opacity=".6"/>
  <rect x="160" width="32" height="32" fill="none"/><path d="M164 27l5-17 7-5 8 8 5 14z" fill="#5f6689"/><path d="M176 5l3 11 8-3" fill="#9fa9e6" opacity=".75"/>
</svg>
`;

const outfits = {
  'mage-apprentice': ['MAGE', 1],
  'mage-archmage': ['MAGE', 10],
  'warrior-recruit': ['WARRIOR', 1],
  'warrior-champion': ['WARRIOR', 10],
  'archer-scout': ['ARCHER', 1],
  'archer-ranger': ['ARCHER', 10],
};

const tileDefinition = {
  image: '/assets/tiles/tiled-world.svg',
  tileWidth: 32,
  tileHeight: 32,
  columns: 6,
  gidToFrame: { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5 },
};

const manifest = {
  version: 2,
  tilesets: {
    greenfields: tileDefinition,
    'crystal-cave': tileDefinition,
  },
  outfits: Object.fromEntries(
    Object.entries(outfits).map(([key, [characterClass, unlockLevel]]) => [
      key,
      {
        image: `/assets/sprites/${key}.png`,
        frameWidth: 32,
        frameHeight: 48,
        columns: 4,
        rows: 4,
        framesPerDirection: 4,
        frameDurationMs: 120,
        directionRows: { SOUTH: 0, WEST: 1, EAST: 2, NORTH: 3 },
        characterClass,
        unlockLevel,
      },
    ]),
  ),
};

await mkdir(dirname(tilesetPath), { recursive: true });
await writeFile(tilesetPath, tileset);
await writeFile(resolve(assetsRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log('Generated the shared Tiled SVG tileset and asset manifest.');
