import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const assetsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');
const tilesetPath = resolve(assetsRoot, 'tiles', 'tiled-world.svg');
const manifestPath = resolve(assetsRoot, 'manifest.json');

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
  outfits: {},
};

await mkdir(dirname(tilesetPath), { recursive: true });
await access(tilesetPath);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log('Validated the committed Tiled SVG tileset and generated the tile asset manifest.');
