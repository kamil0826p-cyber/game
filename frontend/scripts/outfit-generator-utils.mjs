import { createHash } from 'node:crypto';

export const frameWidth = 96;
export const frameHeight = 144;
export const assetVersion = 22;
export const outline = '#090b0e';

export const esc = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
export const hash = (value) => createHash('sha256').update(value).digest().readUInt32BE(0);
export const index = (value, count, salt = '') => hash(`${value}:${salt}`) % count;
export const has = (value, words) => words.some((word) => value.includes(word));

export const componentSignature = (design, gender) => {
  const v = design.variants[gender];
  return [v.profile, v.garment, v.head, v.shoulders, v.weapon, v.offhand, v.back, v.aura, v.detail].join('|');
};

export const metrics = (profile, gender, direction) => {
  const all = {
    stooped: [29, 20, 25, 16, 53], slender: [23, 15, 23, 15, 52], lean: [27, 18, 23, 16, 52],
    tall: [29, 18, 25, 16, 49], broad: [34, 23, 27, 17, 51], massive: [38, 26, 29, 18, 49],
    towering: [40, 28, 31, 19, 46],
  };
  const [shoulder, waist, hem, head, y] = all[profile] ?? all.lean;
  const side = direction === 'WEST' || direction === 'EAST' ? 0.73 : 1;
  return {
    shoulder: shoulder * side - (gender === 'FEMALE' ? 2 : 0),
    waist: waist * side - (gender === 'FEMALE' ? 1 : 0),
    hem: hem * side + (gender === 'FEMALE' ? 2 : 0),
    head: head - (gender === 'FEMALE' ? 1 : 0),
    y,
  };
};
