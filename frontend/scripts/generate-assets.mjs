import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const assetsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');
const tilesetPath = resolve(assetsRoot, 'tiles', 'tiled-world.svg');

const tileset = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="32" viewBox="0 0 192 32" shape-rendering="crispEdges">
  <g id="grass">
    <rect width="32" height="32" fill="#4b842f"/>
    <path d="M0 0h9v4H4v4H0zm18 0h14v7h-5v4h-9zM7 13h9v5h5v7H12v4H3v-8h4zM24 18h8v14H20v-6h4z" fill="#548f35"/>
    <path d="M0 9h5v5H2v6H0zm12-7h4v6h-3v3H9V7h3zm10 10h5v3h-2v5h-4v-4h-3v-3h4zM6 27h5v5H4v-3h2z" fill="#3f7428"/>
    <path d="M4 5h2v1H4zm12 6h1v3h-1zm13 10h2v1h-2zM9 20h1v2H9zm15 7h2v2h-2z" fill="#75a94a"/>
  </g>

  <g id="road" transform="translate(32)">
    <rect width="32" height="32" fill="#a89b69"/>
    <path d="M0 0h11v5H7v4H0zm20 0h12v8h-5v3h-8V6h-4V2h5zM4 14h10v4h6v8h-7v6H2v-9h3v-5H0v-4zm20 5h8v13H18v-5h6z" fill="#b5a875"/>
    <path d="M0 8h5v4H2v3H0zm13-3h5v4h-3v4h-4V8h2zm9 8h6v3h-2v5h-5v-4h-3v-3h4zM7 26h6v4H9v2H4v-4h3z" fill="#918457"/>
    <path d="M4 4h3v2H4zm10 16h4v2h-4zm11 6h3v2h-3zM7 11h2v2H7zm14-8h2v2h-2z" fill="#c9bc86"/>
  </g>

  <g id="pine-trunk" transform="translate(64)">
    <rect width="32" height="32" fill="none"/>
    <path d="M7 28h18v3H4v-2h3z" fill="#183c25" opacity=".5"/>
    <path d="M12 32v-7h-2v-6h2V8h-1V1h4v7h3v8h-2v7h2v7h5v2z" fill="#3b261a"/>
    <path d="M14 30V18h1V7h2v11h-1v12h4v2h-9v-2z" fill="#6f4528"/>
    <path d="M11 14H7v-3H4V7h4v2h4zm6 7h4v-3h4v-4h3v4h-4v3h-5z" fill="#4a2d1d"/>
    <path d="M15 10h2v4h-2zm0 11h2v4h-2z" fill="#a56d40"/>
  </g>

  <g id="pine-canopy" transform="translate(96)">
    <rect width="32" height="32" fill="none"/>
    <path d="M14 0h4v3h3v3h3v4h3v4h3v6h2v6h-5v3h-6v3H11v-3H5v-3H0v-6h2v-6h3v-4h3V6h3V3h3z" fill="#163f27"/>
    <path d="M15 3h3v4h3v4h3v4h3v5h3v3h-6v3H8v-3H2v-3h3v-5h3v-4h3V7h4z" fill="#2f6f39"/>
    <path d="M15 7h3v4h3v4h3v4h-5v3h-7v-3H7v-4h3v-4h2V7z" fill="#4a8a48"/>
    <path d="M5 24h6v3h10v-3h6v3h-4v3H9v-3H5z" fill="#123820"/>
    <path d="M11 10h3v2h-3zm8 4h3v2h-3zM8 18h3v2H8zm13 4h3v2h-3z" fill="#79aa55"/>
  </g>

  <rect x="128" width="32" height="32" fill="#29263b"/>
  <path d="M128 8h32M128 24h32" stroke="#37334d" opacity=".6"/>

  <rect x="160" width="32" height="32" fill="none"/>
  <path d="M164 27l5-17 7-5 8 8 5 14z" fill="#5f6689"/>
  <path d="M176 5l3 11 8-3" fill="#9fa9e6" opacity=".75"/>
</svg>
`;

const outfitRows = {
  MAGE: [
    ['mage-apprentice', 1, 'mage-apprentice'], ['mage-scholar', 1, 'mage-apprentice'],
    ['mage-evoker', 5, 'mage-apprentice'], ['mage-archmage', 10, 'mage-archmage'],
    ['mage-illusionist', 15, 'mage-archmage'], ['mage-elementalist', 20, 'mage-apprentice'],
    ['mage-runekeeper', 30, 'mage-archmage'], ['mage-starcaller', 40, 'mage-archmage'],
    ['mage-chronomancer', 50, 'mage-apprentice'], ['mage-voidseer', 75, 'mage-archmage'],
  ],
  WARRIOR: [
    ['warrior-recruit', 1, 'warrior-recruit'], ['warrior-guard', 1, 'warrior-recruit'],
    ['warrior-vanguard', 5, 'warrior-recruit'], ['warrior-champion', 10, 'warrior-champion'],
    ['warrior-berserker', 15, 'warrior-recruit'], ['warrior-templar', 20, 'warrior-champion'],
    ['warrior-warlord', 30, 'warrior-champion'], ['warrior-dreadnought', 40, 'warrior-recruit'],
    ['warrior-kingsguard', 50, 'warrior-champion'], ['warrior-titan', 75, 'warrior-champion'],
  ],
  ARCHER: [
    ['archer-scout', 1, 'archer-scout'], ['archer-hunter', 1, 'archer-scout'],
    ['archer-pathfinder', 5, 'archer-scout'], ['archer-ranger', 10, 'archer-ranger'],
    ['archer-sharpshooter', 15, 'archer-ranger'], ['archer-beaststalker', 20, 'archer-scout'],
    ['archer-windrunner', 30, 'archer-ranger'], ['archer-nightstalker', 40, 'archer-ranger'],
    ['archer-warden', 50, 'archer-scout'], ['archer-legend', 75, 'archer-ranger'],
  ],
};

const outfits = Object.fromEntries(
  Object.entries(outfitRows).flatMap(([characterClass, rows]) =>
    rows.map(([key, unlockLevel, imageKey]) => [key, { characterClass, unlockLevel, imageKey }]),
  ),
);

const tileDefinition = {
  image: '/assets/tiles/tiled-world.svg',
  tileWidth: 32,
  tileHeight: 32,
  columns: 6,
  gidToFrame: { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5 },
};

const manifest = {
  version: 3,
  tilesets: { greenfields: tileDefinition, 'crystal-cave': tileDefinition },
  outfits: Object.fromEntries(
    Object.entries(outfits).map(([key, definition]) => [key, {
      image: `/assets/sprites/${definition.imageKey}.png`,
      frameWidth: 32,
      frameHeight: 48,
      columns: 4,
      rows: 4,
      framesPerDirection: 4,
      frameDurationMs: 120,
      directionRows: { SOUTH: 0, WEST: 1, EAST: 2, NORTH: 3 },
      characterClass: definition.characterClass,
      unlockLevel: definition.unlockLevel,
    }]),
  ),
};

await mkdir(dirname(tilesetPath), { recursive: true });
await writeFile(tilesetPath, tileset);
await writeFile(resolve(assetsRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log('Generated the shared Tiled SVG tileset and asset manifest.');
