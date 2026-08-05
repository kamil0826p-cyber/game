import { createHash } from 'node:crypto';

export const frameWidth = 96;
export const frameHeight = 144;
export const assetVersion = 23;
export const outline = '#07090d';
export const detailLevel = 'advanced-v6-directional';
export const minimumSheetPrimitives = 720;
export const minimumFramePrimitives = 45;
export const minimumFrameParts = 10;
export const minimumFemaleReadabilityScore = 80;
export const maximumStrokeOnlyRatio = 0.62;

export const esc = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
export const hash = (value) => createHash('sha256').update(value).digest().readUInt32BE(0);
export const index = (value, count, salt = '') => hash(`${value}:${salt}`) % count;
export const has = (value, words) => words.some((word) => String(value).includes(word));

export const headgearMode = (style) => {
  if (has(style, ['helm', 'faceless'])) return 'full';
  if (has(style, ['hood'])) return 'hood';
  if (has(style, ['mask'])) return 'mask';
  if (has(style, ['hat', 'brim'])) return 'hat';
  if (has(style, ['crown', 'circlet', 'tiara'])) return 'ornamental';
  return 'open';
};

export const headgearAllowsHair = (style) => {
  const mode = headgearMode(style);
  return mode === 'open' || mode === 'mask' || mode === 'hat' || mode === 'ornamental';
};

export const headgearHornCount = () => 0;

const clamp = (value, min = 0, max = 255) => Math.max(min, Math.min(max, Math.round(value)));
const hex = (value) => {
  const normalized = value.replace('#', '');
  const expanded = normalized.length === 3
    ? normalized.split('').map((character) => character.repeat(2)).join('')
    : normalized;
  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ];
};

export const mix = (from, to, amount) => {
  const a = hex(from);
  const b = hex(to);
  const t = Math.max(0, Math.min(1, amount));
  return `#${a.map((channel, position) => clamp(channel + (b[position] - channel) * t).toString(16).padStart(2, '0')).join('')}`;
};

export const shade = (color, amount) =>
  mix(color, amount < 0 ? '#000000' : '#ffffff', Math.abs(amount));

export const paletteRamp = (palette) => {
  const [dark, base, accent, glow, skin = '#c99676'] = palette;
  return {
    ink: outline,
    black: mix(dark, '#000000', 0.56),
    dark: shade(dark, -0.08),
    shadow: mix(dark, base, 0.38),
    base,
    mid: mix(base, accent, 0.45),
    accent,
    light: mix(accent, glow, 0.48),
    glow,
    skin,
    skinShadow: mix(skin, dark, 0.28),
    skinLight: mix(skin, '#fff4da', 0.22),
    hair: mix(dark, base, 0.15),
    hairMid: mix(dark, accent, 0.34),
    hairLight: mix(accent, glow, 0.46),
  };
};

export const componentSignature = (design, gender) => {
  const v = design.variants[gender];
  return [v.profile, v.garment, v.head, v.shoulders, v.weapon, v.offhand, v.back, v.aura, v.detail].join('|');
};

const maleProfiles = {
  stooped: { shoulder: 29, chest: 23, waist: 20, hip: 23, hem: 25, head: 16, y: 53, hand: 5.2, foot: 10.2, neck: 7 },
  slender: { shoulder: 23, chest: 18, waist: 15, hip: 18, hem: 23, head: 15, y: 52, hand: 4.8, foot: 9.2, neck: 6 },
  lean: { shoulder: 27, chest: 21, waist: 18, hip: 21, hem: 23, head: 16, y: 52, hand: 5, foot: 9.6, neck: 6.5 },
  tall: { shoulder: 29, chest: 22, waist: 18, hip: 21, hem: 25, head: 16, y: 49, hand: 5.1, foot: 10, neck: 7 },
  broad: { shoulder: 34, chest: 27, waist: 23, hip: 25, hem: 27, head: 17, y: 51, hand: 5.5, foot: 10.8, neck: 8 },
  massive: { shoulder: 38, chest: 31, waist: 26, hip: 29, hem: 29, head: 18, y: 49, hand: 5.9, foot: 11.6, neck: 9 },
  towering: { shoulder: 40, chest: 33, waist: 28, hip: 31, hem: 31, head: 19, y: 46, hand: 6.2, foot: 12.2, neck: 9.5 },
};

const femaleProfiles = {
  stooped: { shoulder: 24, chest: 20, waist: 13, hip: 25, hem: 27, head: 15, y: 52, hand: 4.2, foot: 8.2, neck: 5.5 },
  slender: { shoulder: 20, chest: 18, waist: 12, hip: 26, hem: 28, head: 15, y: 52, hand: 4, foot: 7.8, neck: 5 },
  lean: { shoulder: 22, chest: 19, waist: 13, hip: 27, hem: 29, head: 15, y: 51, hand: 4.2, foot: 8, neck: 5.2 },
  tall: { shoulder: 23, chest: 20, waist: 13, hip: 28, hem: 30, head: 15, y: 48, hand: 4.2, foot: 8.2, neck: 5.4 },
  broad: { shoulder: 26, chest: 22, waist: 15, hip: 30, hem: 32, head: 16, y: 50, hand: 4.4, foot: 8.4, neck: 5.9 },
  massive: { shoulder: 28, chest: 24, waist: 15, hip: 32, hem: 34, head: 17, y: 48, hand: 4.5, foot: 8.6, neck: 6.3 },
  towering: { shoulder: 28, chest: 24, waist: 16, hip: 34, hem: 36, head: 18, y: 45, hand: 4.6, foot: 8.7, neck: 6.6 },
};

export const metrics = (profile, gender, direction) => {
  const source = gender === 'FEMALE' ? femaleProfiles : maleProfiles;
  const base = source[profile] ?? source.lean;
  const side = direction === 'WEST' || direction === 'EAST' ? 0.72 : 1;
  const scale = (value) => Number((value * side).toFixed(2));
  const shoulder = scale(base.shoulder);
  const chest = scale(base.chest);
  const waist = scale(base.waist);
  const hip = scale(base.hip);
  const hem = scale(base.hem);
  return {
    gender,
    profile,
    shoulder,
    chest,
    waist,
    hip,
    hem,
    head: base.head,
    y: base.y,
    hand: base.hand,
    foot: scale(base.foot),
    neck: scale(base.neck),
    side,
    facing: direction === 'WEST' ? -1 : direction === 'EAST' ? 1 : 0,
    north: direction === 'NORTH',
    shoulderHipRatio: Number((shoulder / Math.max(1, hip)).toFixed(3)),
    waistHipRatio: Number((waist / Math.max(1, hip)).toFixed(3)),
  };
};

export const femaleReadabilityScore = (shape) => {
  if (shape.gender !== 'FEMALE') return 100;
  const shoulderScore = Math.max(0, Math.min(25, (1.02 - shape.shoulderHipRatio) * 100));
  const waistScore = Math.max(0, Math.min(35, (0.82 - shape.waistHipRatio) * 125));
  const handScore = Math.max(0, Math.min(15, (5.3 - shape.hand) * 13));
  const footScore = Math.max(0, Math.min(15, (10.3 - shape.foot) * 6));
  return Math.min(100, Math.round(shoulderScore + waistScore + handScore + footScore + 20));
};

export const poseMetrics = (frame, direction) => {
  const stride = [0, 3, 0, -3][frame] ?? 0;
  const bob = [0, -1, 0, 1][frame] ?? 0;
  const arm = [0, -3, 1, 3][frame] ?? 0;
  const cloak = [0, 2, -1, -2][frame] ?? 0;
  const hair = [0, 1.5, 0, -1.5][frame] ?? 0;
  const weapon = [0, -1, 0.5, 1.5][frame] ?? 0;
  const tilt = direction === 'WEST'
    ? -0.55
    : direction === 'EAST'
      ? 0.55
      : frame === 1
        ? 0.35
        : frame === 3
          ? -0.35
          : 0;
  return { stride, bob, arm, cloak, hair, weapon, tilt };
};
