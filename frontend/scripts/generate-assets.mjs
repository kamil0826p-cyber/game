import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
};

const encodePng = (width, height, pixels) => {
  const scanlines = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const targetOffset = y * (1 + width * 4);
    scanlines[targetOffset] = 0;
    pixels.copy(scanlines, targetOffset + 1, y * width * 4, (y + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const image = (width, height) => ({ width, height, pixels: Buffer.alloc(width * height * 4) });

const color = (hex, alpha = 255) => {
  const normalized = hex.replace('#', '');
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
    alpha,
  ];
};

const setPixel = (target, x, y, rgba) => {
  if (x < 0 || y < 0 || x >= target.width || y >= target.height) return;
  const offset = (y * target.width + x) * 4;
  target.pixels[offset] = rgba[0];
  target.pixels[offset + 1] = rgba[1];
  target.pixels[offset + 2] = rgba[2];
  target.pixels[offset + 3] = rgba[3];
};

const fillRect = (target, x, y, width, height, rgba) => {
  for (let py = y; py < y + height; py += 1) {
    for (let px = x; px < x + width; px += 1) setPixel(target, px, py, rgba);
  }
};

const fillCircle = (target, centerX, centerY, radius, rgba) => {
  for (let y = centerY - radius; y <= centerY + radius; y += 1) {
    for (let x = centerX - radius; x <= centerX + radius; x += 1) {
      if ((x - centerX) ** 2 + (y - centerY) ** 2 <= radius ** 2) {
        setPixel(target, x, y, rgba);
      }
    }
  }
};

const line = (target, x0, y0, x1, y1, rgba, thickness = 1) => {
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  let x = x0;
  let y = y0;
  while (true) {
    fillRect(target, x - Math.floor(thickness / 2), y - Math.floor(thickness / 2), thickness, thickness, rgba);
    if (x === x1 && y === y1) break;
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x += sx;
    }
    if (twice <= dx) {
      error += dx;
      y += sy;
    }
  }
};

const writePng = async (relativePath, target) => {
  const output = resolve(root, relativePath);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, encodePng(target.width, target.height, target.pixels));
};

const drawTileSheet = async (key, palette) => {
  const sheet = image(64, 32);
  const ground = color(palette.ground);
  const groundDark = color(palette.groundDark);
  const obstacle = color(palette.obstacle);
  const obstacleDark = color(palette.obstacleDark);
  fillRect(sheet, 0, 0, 32, 32, ground);
  for (let y = 0; y < 32; y += 4) {
    for (let x = (y / 4) % 2 === 0 ? 1 : 3; x < 32; x += 8) {
      fillRect(sheet, x, y + 1, 2, 2, groundDark);
    }
  }
  fillRect(sheet, 32, 0, 32, 32, obstacleDark);
  for (let y = 1; y < 31; y += 6) {
    for (let x = 34 + ((y / 6) % 2) * 3; x < 63; x += 9) {
      fillRect(sheet, x, y, 6, 4, obstacle);
      fillRect(sheet, x + 1, y + 1, 4, 1, color(palette.highlight));
    }
  }
  await writePng(`tiles/${key}.png`, sheet);
};

const outfitDefinitions = {
  'mage-apprentice': {
    className: 'MAGE',
    primary: '#4169a9',
    secondary: '#8b5bc7',
    accent: '#85d7ff',
    hair: '#4b2f74',
    skin: '#f2c59c',
    level: 1,
  },
  'mage-archmage': {
    className: 'MAGE',
    primary: '#30215f',
    secondary: '#7b3fb4',
    accent: '#f3ca52',
    hair: '#e5e7ff',
    skin: '#e7b98e',
    level: 10,
  },
  'warrior-recruit': {
    className: 'WARRIOR',
    primary: '#7d8797',
    secondary: '#8f3540',
    accent: '#d9e2ec',
    hair: '#5a3728',
    skin: '#e7b286',
    level: 1,
  },
  'warrior-champion': {
    className: 'WARRIOR',
    primary: '#9e7424',
    secondary: '#7d182d',
    accent: '#f3d672',
    hair: '#2f1b18',
    skin: '#d99e72',
    level: 10,
  },
  'archer-scout': {
    className: 'ARCHER',
    primary: '#3e7652',
    secondary: '#704b2e',
    accent: '#b8d790',
    hair: '#8a5a2f',
    skin: '#efbd91',
    level: 1,
  },
  'archer-ranger': {
    className: 'ARCHER',
    primary: '#1f5f62',
    secondary: '#26333a',
    accent: '#6ee7c4',
    hair: '#d1b06c',
    skin: '#dca879',
    level: 10,
  },
};

const drawCharacterFrame = (sheet, frameX, frameY, direction, phase, definition) => {
  const originX = frameX * 32;
  const originY = frameY * 48;
  const bob = phase === 1 || phase === 3 ? 1 : 0;
  const stride = phase === 1 ? -2 : phase === 3 ? 2 : 0;
  const shadow = color('#060810', 105);
  const outline = color('#15131b');
  const skin = color(definition.skin);
  const hair = color(definition.hair);
  const primary = color(definition.primary);
  const secondary = color(definition.secondary);
  const accent = color(definition.accent);

  fillCircle(sheet, originX + 16, originY + 43, 8, shadow);
  fillRect(sheet, originX + 11 + stride, originY + 34 + bob, 4, 9, outline);
  fillRect(sheet, originX + 17 - stride, originY + 34 + bob, 4, 9, outline);
  fillRect(sheet, originX + 12 + stride, originY + 34 + bob, 3, 7, secondary);
  fillRect(sheet, originX + 17 - stride, originY + 34 + bob, 3, 7, secondary);
  fillRect(sheet, originX + 9, originY + 20 + bob, 14, 17, outline);
  fillRect(sheet, originX + 10, originY + 20 + bob, 12, 16, primary);
  fillRect(sheet, originX + 11, originY + 27 + bob, 10, 3, secondary);
  fillRect(sheet, originX + 13, originY + 10 + bob, 7, 10, outline);
  fillRect(sheet, originX + 14, originY + 11 + bob, 6, 9, skin);

  if (direction === 'NORTH') {
    fillRect(sheet, originX + 12, originY + 8 + bob, 10, 7, hair);
    fillRect(sheet, originX + 13, originY + 14 + bob, 8, 7, hair);
  } else {
    fillRect(sheet, originX + 12, originY + 8 + bob, 10, 6, hair);
    fillRect(sheet, originX + 13, originY + 12 + bob, 2, 3, hair);
    fillRect(sheet, originX + 20, originY + 12 + bob, 2, 3, hair);
    if (direction === 'SOUTH') {
      setPixel(sheet, originX + 15, originY + 15 + bob, outline);
      setPixel(sheet, originX + 19, originY + 15 + bob, outline);
    }
  }

  const leftArmX = direction === 'EAST' ? 9 : direction === 'WEST' ? 7 : 7;
  const rightArmX = direction === 'EAST' ? 22 : direction === 'WEST' ? 20 : 21;
  fillRect(sheet, originX + leftArmX, originY + 22 + bob, 3, 11, primary);
  fillRect(sheet, originX + rightArmX, originY + 22 + bob, 3, 11, primary);
  fillRect(sheet, originX + leftArmX, originY + 31 + bob, 3, 3, skin);
  fillRect(sheet, originX + rightArmX, originY + 31 + bob, 3, 3, skin);

  if (definition.className === 'MAGE') {
    const staffX = direction === 'WEST' ? originX + 7 : originX + 25;
    line(sheet, staffX, originY + 15, staffX, originY + 41, color('#6f4a2c'), 2);
    fillCircle(sheet, staffX, originY + 13, 3, accent);
    fillRect(sheet, originX + 11, originY + 19 + bob, 10, 2, secondary);
  } else if (definition.className === 'WARRIOR') {
    const swordX = direction === 'WEST' ? originX + 6 : originX + 26;
    line(sheet, swordX, originY + 18, swordX, originY + 39, accent, 2);
    fillRect(sheet, swordX - 3, originY + 31, 7, 2, secondary);
    fillRect(sheet, originX + 12, originY + 20 + bob, 8, 4, accent);
  } else {
    const bowX = direction === 'WEST' ? originX + 5 : originX + 27;
    line(sheet, bowX, originY + 18, bowX, originY + 39, color('#8d5d34'), 2);
    line(sheet, bowX, originY + 18, bowX + (direction === 'WEST' ? 4 : -4), originY + 28, accent, 1);
    line(sheet, bowX, originY + 39, bowX + (direction === 'WEST' ? 4 : -4), originY + 28, accent, 1);
    fillRect(sheet, originX + 13, originY + 7 + bob, 8, 3, primary);
  }
};

const drawOutfit = async (key, definition) => {
  const sheet = image(128, 192);
  const directions = ['SOUTH', 'WEST', 'EAST', 'NORTH'];
  directions.forEach((direction, row) => {
    for (let frame = 0; frame < 4; frame += 1) {
      drawCharacterFrame(sheet, frame, row, direction, frame, definition);
    }
  });
  await writePng(`sprites/${key}.png`, sheet);
};

await drawTileSheet('greenfields', {
  ground: '#355e38',
  groundDark: '#27472e',
  obstacle: '#6b765f',
  obstacleDark: '#30372e',
  highlight: '#9aab86',
});
await drawTileSheet('crystal-cave', {
  ground: '#302b45',
  groundDark: '#242038',
  obstacle: '#4d5270',
  obstacleDark: '#191b29',
  highlight: '#8793c9',
});

for (const [key, definition] of Object.entries(outfitDefinitions)) {
  await drawOutfit(key, definition);
}

const manifest = {
  version: 1,
  tilesets: {
    greenfields: {
      image: '/assets/tiles/greenfields.png',
      tileWidth: 32,
      tileHeight: 32,
      columns: 2,
      gidToFrame: { '1': 0, '2': 1 },
    },
    'crystal-cave': {
      image: '/assets/tiles/crystal-cave.png',
      tileWidth: 32,
      tileHeight: 32,
      columns: 2,
      gidToFrame: { '1': 0, '2': 1 },
    },
  },
  outfits: Object.fromEntries(
    Object.entries(outfitDefinitions).map(([key, definition]) => [
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
        characterClass: definition.className,
        unlockLevel: definition.level,
      },
    ]),
  ),
};

await writeFile(resolve(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log('Generated committed fallback tiles and character sprite sheets.');
