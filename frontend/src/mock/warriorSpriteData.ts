const palettes: Record<string, readonly [string, string, string, string, string]> = {
  'warrior-recruit': ['#202a33', '#7d8d96', '#b9c4c8', '#812f2f', '#9b7048'],
  'warrior-guard': ['#102a36', '#346b82', '#76a8b8', '#285a9b', '#76512f'],
  'warrior-vanguard': ['#20282d', '#65727a', '#aeb7ba', '#8e3f32', '#6d4b31'],
  'warrior-champion': ['#322511', '#a77327', '#e2bd61', '#a61f37', '#704321'],
  'warrior-berserker': ['#2a2928', '#74716d', '#c7c2b9', '#8f3c2c', '#55351f'],
  'warrior-templar': ['#3b3b39', '#b7b6a9', '#eee6c9', '#c49a32', '#6b5430'],
  'warrior-warlord': ['#11161a', '#354148', '#77858b', '#9b1627', '#49301f'],
  'warrior-dreadnought': ['#171c22', '#414d56', '#85929b', '#ad7a2d', '#4d3422'],
  'warrior-kingsguard': ['#21170e', '#6f4b1e', '#c18a30', '#8a1733', '#3d291a'],
  'warrior-titan': ['#241a32', '#624083', '#a579ca', '#7d45b4', '#493054'],
  'warrior-immortal': ['#3b3012', '#c29b35', '#f4dc72', '#20b7b4', '#6e4e23'],
};

const rect = (x: number, y: number, width: number, height: number, fill: string) =>
  `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}"/>`;

const frame = (palette: readonly string[], column: number, row: number): string => {
  const [ink, steel, light, accent, leather] = palette;
  const x = column * 32;
  const y = row * 48;
  const bob = column === 1 ? 1 : column === 3 ? -1 : 0;
  const side = row === 1 ? -1 : row === 2 ? 1 : 0;
  const parts = [
    rect(x + 7, y + 43, 18, 2, '#080b0d66'),
    rect(x + 11, y + 31 + bob, 4, 10, ink), rect(x + 18, y + 31 - bob, 4, 10, ink),
    rect(x + 10, y + 39 + bob, 6, 3, steel), rect(x + 17, y + 39 - bob, 6, 3, steel),
    rect(x + 9 + side, y + 18 + bob, 15, 15, ink), rect(x + 10 + side, y + 19 + bob, 13, 12, steel),
    rect(x + 12 + side, y + 20 + bob, 3, 10, light), rect(x + 16 + side, y + 19 + bob, 2, 12, '#ffffff22'),
    rect(x + 10 + side, y + 30 + bob, 13, 3, leather), rect(x + 15 + side, y + 30 + bob, 3, 3, accent),
    rect(x + 11 + side, y + 8 + bob, 12, 10, '#a96545'), rect(x + 10 + side, y + 5 + bob, 14, 8, ink),
    rect(x + 12 + side, y + 6 + bob, 10, 3, steel), rect(x + 13 + side, y + 6 + bob, 7, 1, light),
    rect(x + 13 + side, y + 12 + bob, 2, 2, '#f2b16d'), rect(x + 19 + side, y + 12 + bob, 2, 2, '#f2b16d'),
    rect(x + 4 + side, y + 21 + bob, 7, 13, ink), rect(x + 5 + side, y + 22 + bob, 5, 10, accent),
    rect(x + 24 + side, y + 15 + bob, 2, 23, leather), rect(x + 23 + side, y + 13 + bob, 4, 4, light),
    rect(x + 7 + side, y + 24 + bob, 1, 6, light), rect(x + 25 + side, y + 19 + bob, 1, 10, '#d8dee0'),
  ];
  if (row === 3) parts.push(rect(x + 12, y + 11 + bob, 10, 3, steel), rect(x + 8, y + 18 + bob, 16, 14, ink));
  return parts.join('');
};

export const maleWarriorSpriteDataUrl = (outfitKey: string): string | null => {
  const palette = palettes[outfitKey];
  if (!palette) return null;
  const frames = Array.from({ length: 4 }, (_, row) =>
    Array.from({ length: 4 }, (_, column) => frame(palette, column, row)).join(''),
  ).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="192" viewBox="0 0 128 192" shape-rendering="crispEdges">${frames}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};
