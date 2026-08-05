import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const assetsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');
const tilesetPath = resolve(assetsRoot, 'tiles', 'tiled-world.svg');
const outfitDirectories = { MALE: 'male', FEMALE: 'female' };

const outfitRows = {
  MAGE: [
    ['mage-apprentice', 1], ['mage-scholar', 10], ['mage-evoker', 20],
    ['mage-archmage', 30], ['mage-illusionist', 40], ['mage-elementalist', 50],
    ['mage-runekeeper', 60], ['mage-starcaller', 70], ['mage-chronomancer', 80],
    ['mage-voidseer', 90], ['mage-ascendant', 100],
  ],
  WARRIOR: [
    ['warrior-recruit', 1], ['warrior-guard', 10], ['warrior-vanguard', 20],
    ['warrior-champion', 30], ['warrior-berserker', 40], ['warrior-templar', 50],
    ['warrior-warlord', 60], ['warrior-dreadnought', 70], ['warrior-kingsguard', 80],
    ['warrior-titan', 90], ['warrior-immortal', 100],
  ],
  ARCHER: [
    ['archer-scout', 1], ['archer-hunter', 10], ['archer-pathfinder', 20],
    ['archer-ranger', 30], ['archer-sharpshooter', 40], ['archer-beaststalker', 50],
    ['archer-windrunner', 60], ['archer-nightstalker', 70], ['archer-warden', 80],
    ['archer-legend', 90], ['archer-starshot', 100],
  ],
};

const outfits = Object.fromEntries(
  Object.entries(outfitRows).flatMap(([characterClass, rows]) =>
    rows.map(([key, unlockLevel], tier) => [key, { characterClass, unlockLevel, tier }]),
  ),
);

const palettes = {
  MAGE: [
    ['#27345d', '#476ed1', '#8fc8ff'], ['#54462f', '#e0c386', '#fff1b8'],
    ['#5d2431', '#d14b5d', '#ffb18e'], ['#3f276b', '#8d5bd1', '#e3bcff'],
    ['#164e54', '#37a4a8', '#a5fff4'], ['#6a2b18', '#ef7a35', '#ffe07a'],
    ['#26384c', '#5789ad', '#b9e5ff'], ['#171c48', '#4559a8', '#d7ddff'],
    ['#4b4654', '#a6a0b5', '#ecf4ff'], ['#17131e', '#665078', '#d8b1ff'],
    ['#5f4a1c', '#f2c94c', '#fff9bd'],
  ],
  WARRIOR: [
    ['#3a4048', '#7d8793', '#cad1d8'], ['#243c5a', '#4f7da8', '#b8ddff'],
    ['#4b3030', '#94504c', '#e3a28e'], ['#69511d', '#d7ad3e', '#ffe598'],
    ['#493422', '#8a6540', '#d7b177'], ['#676052', '#d9ceaa', '#fff9d9'],
    ['#2d2730', '#705064', '#d89689'], ['#24282d', '#545d68', '#aeb7c2'],
    ['#191b20', '#a27d30', '#f7d978'], ['#352650', '#7761a8', '#d8c5ff'],
    ['#5a4b21', '#d8b84f', '#fff1a0'],
  ],
  ARCHER: [
    ['#253b2b', '#4d7754', '#a6c783'], ['#4a3726', '#765d39', '#c7a269'],
    ['#30443b', '#66816f', '#bed5bd'], ['#173f44', '#39777a', '#9fd6cf'],
    ['#41454d', '#7b8490', '#d0d8e0'], ['#4c3424', '#83563c', '#cda67b'],
    ['#33554b', '#72a793', '#d5fff1'], ['#171d25', '#3c4b5e', '#8fa2bd'],
    ['#1f4a32', '#4d9465', '#b8e0a9'], ['#55451d', '#b08a35', '#f4dc82'],
    ['#35214e', '#7652a4', '#d9b9ff'],
  ],
};

const esc = (value) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');

const weaponMarkup = (characterClass, accent, shine) => {
  if (characterClass === 'MAGE') {
    return `<path d="M72 45l4 61" stroke="${shine}" stroke-width="5"/><circle cx="72" cy="39" r="9" fill="${accent}" stroke="${shine}" stroke-width="3"/><path d="M68 38l4-7 4 7-4 7z" fill="${shine}"/>`;
  }
  if (characterClass === 'WARRIOR') {
    return `<path d="M72 42l-3 67" stroke="${shine}" stroke-width="5"/><path d="M66 43l6-15 6 15-6 8z" fill="${shine}"/><path d="M67 89h13v24H67z" fill="${accent}" stroke="${shine}" stroke-width="2"/>`;
  }
  return `<path d="M72 35q18 34 0 74" fill="none" stroke="${shine}" stroke-width="4"/><path d="M72 35q-17 34 0 74" fill="none" stroke="${accent}" stroke-width="3"/><path d="M57 74h22" stroke="${shine}" stroke-width="2"/><path d="M76 70l8 4-8 4z" fill="${shine}"/>`;
};

const createSpriteSvg = (key, definition, gender) => {
  const { characterClass, tier } = definition;
  const [dark, accent, shine] = palettes[characterClass][tier];
  const female = gender === 'FEMALE';
  const torsoLeft = female ? 31 : 27;
  const torsoRight = female ? 65 : 69;
  const hair = female
    ? `<path d="M32 31q3-20 16-20t17 20l-3 27-8-14-6 10-7-10-7 14z" fill="${dark}"/><path d="M35 49q-1 18 5 29" stroke="${accent}" stroke-width="4"/>`
    : `<path d="M32 31q4-20 16-20t16 20l-7-8-8 5-8-5z" fill="${dark}"/><path d="M36 16l6-7 7 6 7-7 5 10" fill="none" stroke="${accent}" stroke-width="4"/>`;
  const silhouette = characterClass === 'MAGE'
    ? `M${torsoLeft} 56Q48 48 ${torsoRight} 56L72 116Q48 130 24 116z`
    : characterClass === 'WARRIOR'
      ? `M${torsoLeft - 4} 56Q48 45 ${torsoRight + 4} 56L68 112H28z`
      : `M${torsoLeft} 56Q48 49 ${torsoRight} 56L64 112H32z`;
  const tierMarks = Array.from({ length: Math.min(5, 1 + Math.floor(tier / 2)) }, (_, i) =>
    `<circle cx="${38 + i * 5}" cy="73" r="1.7" fill="${shine}"/>`,
  ).join('');
  const aura = tier >= 7
    ? `<path d="M19 57Q8 75 19 100M77 57q11 18 0 43" fill="none" stroke="${shine}" stroke-width="2" opacity=".55"/>`
    : '';
  const frameTransforms = [
    'translate(0 0)', 'translate(0 -2) skewX(1)', 'translate(0 1) scale(1 .99)', 'translate(0 -1) skewX(-1)',
  ];
  const uses = [];
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      const x = col * 96;
      const y = row * 144;
      const mirror = row === 1 ? 'translate(96 0) scale(-1 1)' : '';
      const north = row === 3 ? 'translate(0 1) scale(1 .985)' : '';
      uses.push(`<g transform="translate(${x} ${y}) ${mirror} ${north} ${frameTransforms[col]}"><use href="#c"/></g>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="384" height="576" viewBox="0 0 384 576" data-outfit="${esc(key)}" data-gender="${gender}"><defs><linearGradient id="g" x2="0" y2="1"><stop stop-color="${accent}"/><stop offset="1" stop-color="${dark}"/></linearGradient><g id="c">${aura}<ellipse cx="48" cy="126" rx="25" ry="7" fill="#080b10" opacity=".45"/><path d="M34 104l-5 22h13l6-22 6 22h13l-5-22z" fill="${dark}"/><path d="M27 121h16v9H25zM53 121h16l2 9H53z" fill="#15181d"/><path d="${silhouette}" fill="url(#g)" stroke="#12161d" stroke-width="3"/><path d="M31 61l-12 28 10 5 9-25M65 61l12 28-10 5-9-25" fill="${accent}" stroke="#12161d" stroke-width="3"/><path d="M28 57l9-8 11 7 11-7 9 8-6 12H34z" fill="${shine}" opacity=".75"/><path d="M31 83h34v8H31z" fill="${dark}"/><rect x="44" y="83" width="8" height="8" rx="2" fill="${shine}"/><path d="M36 95l12 8 12-8" fill="none" stroke="${shine}" stroke-width="3"/>${tierMarks}<circle cx="48" cy="35" r="17" fill="#d6a77e" stroke="#12161d" stroke-width="3"/>${hair}<circle cx="42" cy="36" r="2" fill="#161a20"/><circle cx="54" cy="36" r="2" fill="#161a20"/><path d="M44 45q4 3 8 0" fill="none" stroke="#8d5e4b" stroke-width="2"/>${weaponMarkup(characterClass, accent, shine)}<path d="M29 66l7 3M67 66l-7 3" stroke="#fff" stroke-width="2" opacity=".45"/></g></defs>${uses.join('')}</svg>\n`;
};

const tileDefinition = {
  image: '/assets/tiles/tiled-world.svg', tileWidth: 32, tileHeight: 32, columns: 6,
  gidToFrame: { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5 },
};

const manifest = {
  version: 18,
  tilesets: { greenfields: tileDefinition, 'crystal-cave': tileDefinition },
  outfits: Object.fromEntries(Object.entries(outfits).map(([key, definition]) => [key, {
    image: `/assets/sprites/${outfitDirectories.MALE}/${key}.svg?v=18`,
    images: {
      MALE: `/assets/sprites/${outfitDirectories.MALE}/${key}.svg?v=18`,
      FEMALE: `/assets/sprites/${outfitDirectories.FEMALE}/${key}.svg?v=18`,
    },
    frameWidth: 96, frameHeight: 144, columns: 4, rows: 4, framesPerDirection: 4,
    frameDurationMs: 120, directionRows: { SOUTH: 0, WEST: 1, EAST: 2, NORTH: 3 },
    characterClass: definition.characterClass, unlockLevel: definition.unlockLevel,
  }])) ,
};

await mkdir(assetsRoot, { recursive: true });
await access(tilesetPath);
for (const [key, definition] of Object.entries(outfits)) {
  for (const [gender, directory] of Object.entries(outfitDirectories)) {
    const spriteDirectory = resolve(assetsRoot, 'sprites', directory);
    await mkdir(spriteDirectory, { recursive: true });
    await writeFile(resolve(spriteDirectory, `${key}.svg`), createSpriteSvg(key, definition, gender));
  }
}
await writeFile(resolve(assetsRoot, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
console.log('Generated 33 male and 33 female high-resolution SVG outfit sheets and the asset manifest.');
