import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const assetsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');
const tilesetPath = resolve(assetsRoot, 'tiles', 'tiled-world.svg');

const tileset = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="32" viewBox="0 0 192 32" shape-rendering="crispEdges">
  <g id="grass">
    <rect width="32" height="32" fill="#4a812f"/>
    <path d="M0 2h5v2H3v2H0zm8-2h7v2h-3v2H8zm11 1h6v2h-2v2h-5V3h1zm8-1h5v6h-2V4h-3zM2 8h6v2H5v3H1v-2H0V9h2zm10-3h5v2h-2v3h-4V8H9V6h3zm9 3h7v2h-3v2h-5v-2h-1V9h3zm8 2h3v5h-2v-2h-2v-2h2zM0 16h4v2H2v3H0zm6-2h7v2H9v3H5v-2H3v-2h3zm10 1h5v2h-2v4h-4v-3h-2v-2h3zm8-2h8v3h-3v2h-6v-3h1zM2 23h6v2H5v3H0v-2h2zm10-2h4v3h3v2h-6v-2h-3v-2h2zm10 1h7v2h-2v3h-5v-2h-3v-2h3zm7 6h3v4h-6v-2h3zM8 29h6v3H7v-2h1zm10-1h5v4h-6v-2h1z" fill="#568f38"/>
    <path d="M4 1h3v1H5v2H3V2h1zm12 1h2v3h-1v2h-2V4h1zm10 3h4v1h-2v2h-3V7h-2V6h3zM7 10h3v1H8v3H6v-2H4v-1h3zm10-1h2v4h-1v2h-3v-1h1v-3h1zm11 3h3v1h-2v3h-2v-2h-2v-1h3zM2 18h3v1H4v3H1v-2H0v-1h2zm9-1h3v1h-1v3h-3v-2H8v-1h3zm11 2h2v3h-1v2h-3v-1h1v-3h1zm6 1h4v2h-2v3h-3v-2h-2v-1h3zM5 25h2v3H6v2H3v-1h1v-3h1zm10 1h3v1h-1v3h-3v-2h-2v-1h3zm9 1h3v1h-1v3h-3v-2h-2v-1h3z" fill="#3d6f29"/>
    <path d="M1 5h1v1H1zm5 1h2v1H6zm5-3h1v2h-1zm9 3h2v1h-2zm9 1h1v2h-1zM3 13h2v1H3zm8-1h1v2h-1zm9 1h2v1h-2zm9 4h2v1h-2zM1 22h1v2H1zm7-2h2v1H8zm8 3h1v2h-1zm9-3h2v1h-2zm5 5h1v2h-1zM10 27h2v1h-2zm9 3h2v1h-2z" fill="#79ab4d"/>
    <path d="M5 4h1v2H5zm-1 1h3v1H4zM23 8h1v2h-1zm-1 1h3v1h-3zM9 22h1v2H9zm-1 1h3v1H8z" fill="#2d5f25"/>
    <path d="M14 6h1v1h-1zm10 10h1v1h-1zM4 27h1v1H4z" fill="#d7c05b"/>
  </g>
  <g id="road" transform="translate(32)">
    <rect width="32" height="32" fill="#a69766"/>
    <path d="M0 1h6v2H3v2H0zm10-1h6v2h-2v2H9V2h1zm10 2h7v2h-3v2h-6V4h2zm8-2h4v7h-2V4h-2zM2 8h5v2H4v3H0v-2h2zm9-3h5v2h-2v3h-4V8H8V6h3zm9 3h8v2h-3v3h-6v-2h-2V9h3zm9 4h3v4h-5v-2h2zM0 16h5v2H3v3H0zm7-2h7v2h-3v3H6v-2H4v-2h3zm10 1h5v2h-2v4h-4v-3h-2v-2h3zm8-2h7v3h-3v2h-6v-3h2zM2 23h6v2H5v3H0v-2h2zm10-2h5v3h3v2h-7v-2h-3v-2h2zm10 1h7v2h-2v3h-5v-2h-3v-2h3zm7 6h3v4h-6v-2h3zM8 29h6v3H7v-2h1zm10-1h5v4h-6v-2h1z" fill="#b3a574"/>
    <path d="M4 1h2v1H5v2H3V3H2V2h2zm12 2h3v1h-1v3h-3V5h-2V4h3zm10 3h4v1h-2v2h-3V8h-2V7h3zM7 10h3v1H8v3H6v-2H4v-1h3zm10-1h2v4h-1v2h-3v-1h1v-3h1zm11 3h3v1h-2v3h-2v-2h-2v-1h3zM2 18h3v1H4v3H1v-2H0v-1h2zm9-1h3v1h-1v3h-3v-2H8v-1h3zm11 2h2v3h-1v2h-3v-1h1v-3h1zm6 1h4v2h-2v3h-3v-2h-2v-1h3zM5 25h2v3H6v2H3v-1h1v-3h1zm10 1h3v1h-1v3h-3v-2h-2v-1h3zm9 1h3v1h-1v3h-3v-2h-2v-1h3z" fill="#8d8054"/>
    <path d="M2 5h2v1H2zm6 1h1v2H8zm4-4h2v1h-2zm7 4h1v2h-1zm9 1h2v1h-2zM3 13h2v1H3zm8-1h2v1h-2zm8 2h2v1h-2zm10 3h2v1h-2zM1 22h2v1H1zm7-2h2v1H8zm8 3h1v2h-1zm9-3h2v1h-2zm5 5h1v2h-1zM10 27h2v1h-2zm9 3h2v1h-2z" fill="#c8ba87"/>
    <path d="M5 9h2v1H5zm8 6h1v1h-1zm10-4h2v1h-2zM4 24h1v1H4zm10 4h2v1h-2z" fill="#706747"/>
  </g>
  <g id="pine-trunk" transform="translate(64)">
    <rect width="32" height="32" fill="none"/>
    <path d="M5 28h7v-2h8v2h7v2h-4v2H7v-1H3v-2h2z" fill="#173a25" opacity=".48"/>
    <path d="M11 0h9v5h2v7h-1v6h2v6h-1v5h4v3H7v-3h2v-6H8v-6h2V9H9V3h2z" fill="#342117"/>
    <path d="M13 1h5v7h1v5h-1v7h2v5h-1v5h3v2H10v-2h2v-7h-1v-6h2V9h-1V4h1z" fill="#6b4228"/>
    <path d="M15 2h2v8h-1v5h1v6h-1v7h2v3h-4v-6h1v-6h-1v-6h1z" fill="#a66b3e"/>
    <path d="M10 11H7V9H4V6h4v2h3zm10 6h4v-3h4v-3h2v4h-4v3h-5zM9 22H6v-2H3v-3h4v2h3z" fill="#3d2518"/>
    <path d="M13 7h2v2h-2zm4 7h2v2h-2zm-5 5h2v2h-2zm4 6h2v2h-2z" fill="#c38450"/>
    <path d="M7 29h3v-3h3v4h2v2H5v-2H2v-1h5zm11 1h3v-4h2v3h3v2h4v1H19z" fill="#342117"/>
    <path d="M3 30h2v-2h2v4H2zm23 0h2v-2h2v3h2v1h-7z" fill="#4f8237"/>
  </g>
  <g id="pine-canopy" transform="translate(96)">
    <rect width="32" height="32" fill="none"/>
    <path d="M14 0h5v2h3v3h3v3h3v4h2v4h2v6h-3v4h-4v3h-5v3H11v-3H6v-3H2v-4H0v-6h2v-4h2V8h3V5h3V2h4z" fill="#123821"/>
    <path d="M15 2h3v4h3v3h3v4h3v4h3v4h-4v3h-5v3H10v-3H5v-3H2v-4h3v-4h3V9h3V6h4z" fill="#286036"/>
    <path d="M14 6h5v3h3v4h4v3h3v3h-5v3h-6v3h-5v-3H7v-3H3v-3h4v-3h3V9h4z" fill="#3f8044"/>
    <path d="M13 11h6v3h4v3h4v2h-5v3H10v-3H5v-2h4v-3h4z" fill="#559450"/>
    <path d="M4 21h5v-2h4v3h6v-3h4v2h5v3h-4v3h-5v3h-7v-3H7v-3H4z" fill="#1b4a2a"/>
    <path d="M5 26h5v2h4v2h4v-2h4v-2h5v3h-4v2H9v-2H5z" fill="#0d3020"/>
    <path d="M11 6h2v2h-2zm7 3h2v2h-2zm-10 5h3v2H8zm13 3h3v2h-3zM9 21h2v2H9zm12 3h2v2h-2z" fill="#78ae60"/>
    <path d="M14 4h1v2h-1zm6 8h2v1h-2zM6 18h2v1H6zm18 4h2v1h-2zM12 26h2v1h-2z" fill="#a2ce80"/>
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
