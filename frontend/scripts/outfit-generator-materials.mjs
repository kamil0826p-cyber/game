import { esc, has, hash, paletteRamp } from './outfit-generator-utils.mjs';

const classify = (value) => {
  if (has(value, ['crystal', 'astral', 'star', 'moon', 'void', 'arcane', 'rune', 'orb'])) return 'crystal';
  if (has(value, ['bone', 'skull', 'fang', 'antler', 'claw'])) return 'bone';
  if (has(value, ['root', 'bark', 'wood', 'branch', 'thorn', 'vine'])) return 'wood';
  if (has(value, ['organic', 'corrupt', 'blood', 'beast', 'dragon', 'wyvern', 'scale'])) return 'organic';
  if (has(value, ['fur', 'pelt', 'hide', 'wolf'])) return 'fur';
  if (has(value, ['mail', 'chain'])) return 'mail';
  if (has(value, ['plate', 'armor', 'helm', 'shield', 'metal', 'iron', 'steel'])) return 'plate';
  if (has(value, ['leather', 'jerkin', 'vest', 'boot', 'glove'])) return 'leather';
  if (has(value, ['silk', 'veil', 'ribbon', 'dress', 'gown'])) return 'silk';
  return 'cloth';
};

export const collectMaterialFamilies = (variant) => [
  classify(variant.garment),
  classify(variant.shoulders),
  classify(variant.head),
  classify(variant.weapon),
  classify(variant.back),
].filter((value, index, all) => all.indexOf(value) === index);

const torsoPath = (m) => {
  const left = Math.round(48 - m.chest);
  const right = Math.round(48 + m.chest);
  const waistLeft = Math.round(48 - m.waist);
  const waistRight = Math.round(48 + m.waist);
  const hipLeft = Math.round(48 - m.hip);
  const hipRight = Math.round(48 + m.hip);
  const top = m.y + 12;
  return m.gender === 'FEMALE'
    ? `M${left} ${top}Q48 ${top - 7} ${right} ${top}L${waistRight} 90Q${hipRight} 101 ${hipRight} 108Q48 114 ${hipLeft} 108Q${waistLeft} 101 ${waistLeft} 90z`
    : `M${left} ${top}Q48 ${top - 7} ${right} ${top}L${waistRight + 5} 107Q48 113 ${waistLeft - 5} 107z`;
};

const plate = (ramp, m) => {
  const rivets = [
    [38, m.y + 27], [48, m.y + 24], [58, m.y + 27],
    [37, m.y + 43], [48, m.y + 47], [59, m.y + 43],
  ].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.5" fill="${ramp.glow}" stroke="${ramp.ink}" stroke-width=".6"/>`).join('');
  return `${rivets}<path d="M35 ${m.y + 18}l13 7 13-7M33 ${m.y + 35}h30M37 ${m.y + 50}h22M48 ${m.y + 25}v36" fill="none" stroke="${ramp.light}" stroke-width="1.25" opacity=".75"/><path d="M34 ${m.y + 37}q14 5 28 0" fill="none" stroke="${ramp.shadow}" stroke-width="2"/>`;
};

const mail = (ramp, m) => Array.from({ length: 5 }, (_, row) =>
  Array.from({ length: 6 }, (_, column) => {
    const x = 36 + column * 4.8 + (row % 2 ? 2.4 : 0);
    const y = m.y + 20 + row * 7;
    return `<circle cx="${x.toFixed(1)}" cy="${y}" r="2" fill="none" stroke="${(row + column) % 3 ? ramp.mid : ramp.light}" stroke-width=".8" opacity=".78"/>`;
  }).join(''),
).join('');

const leather = (ramp, m) => {
  const stitches = Array.from({ length: 8 }, (_, i) => {
    const y = m.y + 18 + i * 6;
    return `<path d="M31 ${y}l5 2M65 ${y}l-5 2" stroke="${i % 2 ? ramp.light : ramp.accent}" stroke-width=".9"/>`;
  }).join('');
  return `<path d="M34 ${m.y + 17}l28 35M62 ${m.y + 17}L34 ${m.y + 52}" stroke="${ramp.shadow}" stroke-width="3"/><path d="M35 ${m.y + 17}l27 34M61 ${m.y + 17}L35 ${m.y + 51}" stroke="${ramp.light}" stroke-width=".8" stroke-dasharray="3 3"/>${stitches}`;
};

const cloth = (ramp, m, silk = false) => {
  const folds = [34, 41, 48, 55, 62].map((x, i) => `<path d="M${x} ${m.y + 18}q${i % 2 ? 4 : -4} 18 ${x + (i % 2 ? 2 : -2)} ${m.y + 55}" fill="none" stroke="${i === 2 ? ramp.light : ramp.mid}" stroke-width="${silk ? .9 : 1.2}" opacity="${silk ? .72 : .58}"/>`).join('');
  return `${folds}<path d="M35 ${m.y + 31}q13 7 26 0M33 ${m.y + 46}q15 7 30 0" fill="none" stroke="${silk ? ramp.glow : ramp.light}" stroke-width="1.1" opacity=".62"/>`;
};

const fur = (ramp, m) => Array.from({ length: 14 }, (_, i) => {
  const side = i % 2 ? 1 : -1;
  const row = Math.floor(i / 2);
  const x = 48 + side * (m.chest - 3 - (row % 3));
  const y = m.y + 17 + row * 7;
  return `<path d="M${x - side * 4} ${y - 2}l${side * 4} 5 ${side * 4}-6" fill="none" stroke="${i % 4 === 0 ? ramp.light : ramp.mid}" stroke-width="1.2" opacity=".8"/>`;
}).join('');

const bone = (ramp, m) => Array.from({ length: 6 }, (_, i) => {
  const y = m.y + 19 + i * 7;
  return `<path d="M37 ${y}q11-${4 + i % 2} 22 0" fill="none" stroke="${i % 2 ? ramp.light : ramp.glow}" stroke-width="1.2" opacity=".72"/>`;
}).join('');

const crystal = (ramp, m) => [
  [48, m.y + 22, 6], [40, m.y + 36, 4], [56, m.y + 36, 4], [44, m.y + 51, 3], [52, m.y + 51, 3],
].map(([x, y, size], i) => `<polygon points="${x},${y - size} ${x + size},${y} ${x},${y + size} ${x - size},${y}" fill="${i === 0 ? ramp.accent : 'none'}" stroke="${i % 2 ? ramp.light : ramp.glow}" stroke-width="1" opacity=".78"/>`).join('');

const wood = (ramp, m) => Array.from({ length: 7 }, (_, i) => {
  const x = 36 + (i % 4) * 8;
  const y = m.y + 18 + Math.floor(i / 4) * 23;
  return `<path d="M${x} ${y + 14}q${i % 2 ? 5 : -5}-8 ${i % 2 ? 2 : -2}-15" fill="none" stroke="${i % 3 ? ramp.mid : ramp.light}" stroke-width="1.1" opacity=".7"/>`;
}).join('');

const organic = (ramp, m) => `<path d="M48 ${m.y + 18}q-14 12-10 30M48 ${m.y + 18}q14 12 10 30M48 ${m.y + 24}v34" fill="none" stroke="${ramp.glow}" stroke-width="1.2" opacity=".62"/>${[35, 42, 54, 61].map((x, i) => `<circle cx="${x}" cy="${m.y + 36 + (i % 2) * 12}" r="${1.5 + i % 2}" fill="${ramp.accent}" opacity=".45"/>`).join('')}`;

const renderFamily = (family, ramp, shape) => {
  if (family === 'plate') return plate(ramp, shape);
  if (family === 'mail') return mail(ramp, shape);
  if (family === 'leather') return leather(ramp, shape);
  if (family === 'fur') return fur(ramp, shape);
  if (family === 'bone') return bone(ramp, shape);
  if (family === 'crystal') return crystal(ramp, shape);
  if (family === 'wood') return wood(ramp, shape);
  if (family === 'organic') return organic(ramp, shape);
  if (family === 'silk') return cloth(ramp, shape, true);
  return cloth(ramp, shape, false);
};

export const materialDetailLayer = ({ variant, palette, shape, seed }) => {
  const ramp = paletteRamp(palette);
  const families = collectMaterialFamilies(variant);
  const primary = families[0] ?? 'cloth';
  const clipId = `torso-${hash(seed).toString(16)}`;
  const path = torsoPath(shape);
  return `<g data-part="material-detail-layer" data-materials="${esc(families.join(','))}" data-random-strokes="0"><defs><clipPath id="${clipId}"><path d="${path}"/></clipPath></defs><g data-part="material-primary" data-material="${primary}" clip-path="url(#${clipId})">${renderFamily(primary, ramp, shape)}</g><path d="${path}" fill="none" stroke="${ramp.light}" stroke-width=".8" opacity=".32"/></g>`;
};
