import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const assetsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');
const tilesetPath = resolve(assetsRoot, 'tiles', 'tiled-world.svg');
const manifestPath = resolve(assetsRoot, 'manifest.json');

const outfitRows = {
  MAGE: [
    ['mage-apprentice', 1],
    ['mage-scholar', 10],
    ['mage-evoker', 20],
    ['mage-archmage', 30],
    ['mage-illusionist', 40],
    ['mage-elementalist', 50],
    ['mage-runekeeper', 60],
    ['mage-starcaller', 70],
    ['mage-chronomancer', 80],
    ['mage-voidseer', 90],
    ['mage-ascendant', 100],
  ],
  WARRIOR: [
    ['warrior-recruit', 1],
    ['warrior-guard', 10],
    ['warrior-vanguard', 20],
    ['warrior-champion', 30],
    ['warrior-berserker', 40],
    ['warrior-templar', 50],
    ['warrior-warlord', 60],
    ['warrior-dreadnought', 70],
    ['warrior-kingsguard', 80],
    ['warrior-titan', 90],
    ['warrior-immortal', 100],
  ],
  ARCHER: [
    ['archer-scout', 1],
    ['archer-hunter', 10],
    ['archer-pathfinder', 20],
    ['archer-ranger', 30],
    ['archer-sharpshooter', 40],
    ['archer-beaststalker', 50],
    ['archer-windrunner', 60],
    ['archer-nightstalker', 70],
    ['archer-warden', 80],
    ['archer-legend', 90],
    ['archer-starshot', 100],
  ],
};

const outfits = Object.fromEntries(
  Object.entries(outfitRows).flatMap(([characterClass, rows]) =>
    rows.map(([key, unlockLevel]) => [key, { characterClass, unlockLevel }]),
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
  version: 16,
  tilesets: { greenfields: tileDefinition, 'crystal-cave': tileDefinition },
  outfits: Object.fromEntries(
    Object.entries(outfits).map(([key, definition]) => [key, {
      image: `/assets/sprites/male/${key}.png?v=16`,
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
await access(tilesetPath);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log('Validated the committed Tiled SVG tileset and generated an exact outfit manifest.');
