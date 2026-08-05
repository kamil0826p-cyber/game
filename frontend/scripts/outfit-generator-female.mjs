import { esc, has, paletteRamp } from './outfit-generator-utils.mjs';

const feminineTorso = (variant, ramp, m) => {
  const chestLeft = 48 - m.chest;
  const chestRight = 48 + m.chest;
  const waistLeft = 48 - m.waist;
  const waistRight = 48 + m.waist;
  const hipLeft = 48 - m.hip;
  const hipRight = 48 + m.hip;
  const plate = has(variant.garment, ['plate', 'armor', 'mail', 'scale']);
  const tailored = plate
    ? `<path d="M${chestLeft + 3} ${m.y + 14}Q48 ${m.y + 4} ${chestRight - 3} ${m.y + 14}L${waistRight + 1} 91Q48 98 ${waistLeft - 1} 91z" fill="none" stroke="${ramp.light}" stroke-width="1.7" opacity=".78"/><path d="M36 ${m.y + 26}q12-7 24 0M35 ${m.y + 32}q13 6 26 0" fill="none" stroke="${ramp.shadow}" stroke-width="1.4"/><path d="M${waistLeft - 1} 91l${hipLeft - waistLeft - 2} 15M${waistRight + 1} 91l${hipRight - waistRight + 2} 15" stroke="${ramp.light}" stroke-width="1.8"/><path d="M37 103l5-8 6 6 6-6 5 8-3 12H40z" fill="${ramp.mid}" stroke="${ramp.ink}" stroke-width="2"/>`
    : `<path d="M${chestLeft + 2} ${m.y + 13}Q48 ${m.y + 5} ${chestRight - 2} ${m.y + 13}Q${waistRight + 3} 73 ${waistRight} 91Q${hipRight} 103 ${hipRight + 1} 112M${chestLeft - 2} ${m.y + 13}Q${waistLeft - 3} 73 ${waistLeft} 91Q${hipLeft} 103 ${hipLeft - 1} 112" fill="none" stroke="${ramp.light}" stroke-width="1.8" opacity=".72"/><path d="M${waistLeft} 86q${m.waist} 6 ${m.waist * 2} 0M${hipLeft} 105q${m.hip} 7 ${m.hip * 2} 0" fill="none" stroke="${ramp.accent}" stroke-width="1.6"/>`;
  return `<g data-part="female-silhouette" data-profile="${esc(m.profile)}">${tailored}<path d="M${waistLeft - 2} 94q${m.waist + 2} 5 ${m.waist * 2 + 4} 0" fill="none" stroke="${ramp.ink}" stroke-width="5"/><path d="M${waistLeft - 1} 93q${m.waist + 1} 4 ${m.waist * 2 + 2} 0" fill="none" stroke="${ramp.glow}" stroke-width="1.3"/></g>`;
};

const feminineGarment = (variant, ramp, m) => {
  const robe = has(variant.garment, ['robe', 'gown', 'dress', 'regalia', 'vestment', 'cloak', 'coat']);
  const hip = m.hip;
  const sidePanels = m.facing !== 0
    ? `<path d="M${48 + m.facing * (m.waist + 2)} 72q${m.facing * 4} 16 0 33M${48 + m.facing * (m.hip + 1)} 98q${m.facing * 3} 9 0 19" fill="none" stroke="${ramp.glow}" stroke-width="1.3"/>`
    : '';
  const panels = robe
    ? `<path d="M48 91v31M${48 - hip + 4} 100q${hip - 4} 8 ${hip * 2 - 8} 0M${48 - hip + 2} 112q${hip - 2} 7 ${hip * 2 - 4} 0" fill="none" stroke="${ramp.light}" stroke-width="1.5" opacity=".68"/><path d="M36 101l5 18 7-13 7 13 5-18" fill="none" stroke="${ramp.accent}" stroke-width="1.5"/><path d="M40 106l3 3-3 3m16-6-3 3 3 3" fill="none" stroke="${ramp.glow}" stroke-width="1"/>`
    : `<path d="M${48 - hip} 99l4 21h13l3-21m0 0 3 21h13l4-21" fill="none" stroke="${ramp.light}" stroke-width="1.6"/><path d="M${48 - hip + 5} 104h${hip * 2 - 10}M38 113h20" stroke="${ramp.accent}" stroke-width="1.2"/>`;
  return `<g data-part="female-garment" data-style="${esc(variant.garment)}">${panels}${sidePanels}</g>`;
};

const feminineScaleDetails = (ramp, m) => {
  const side = m.facing !== 0;
  const left = side ? 48 + m.facing * (m.shoulder + 7) : 48 - m.shoulder - 4;
  const right = side ? left : 48 + m.shoulder + 4;
  const hands = side
    ? `<ellipse cx="${left}" cy="${m.y + 65}" rx="${m.hand}" ry="${m.hand + 1}" fill="none" stroke="${ramp.skinLight}" stroke-width="1.1"/>`
    : `<ellipse cx="${left}" cy="${m.y + 65}" rx="${m.hand}" ry="${m.hand + 1}" fill="none" stroke="${ramp.skinLight}" stroke-width="1.1"/><ellipse cx="${right}" cy="${m.y + 65}" rx="${m.hand}" ry="${m.hand + 1}" fill="none" stroke="${ramp.skinLight}" stroke-width="1.1"/>`;
  const boots = `<path d="M${48 - m.hip + 4} 124h${m.foot + 4}M${48 + m.hip - m.foot - 8} 124h${m.foot + 4}" stroke="${ramp.light}" stroke-width="1.3"/><path d="M${48 - m.hip + 6} 127h${m.foot}M${48 + m.hip - m.foot - 6} 127h${m.foot}" stroke="${ramp.accent}" stroke-width="1"/>`;
  return `<g data-part="female-scale-details" data-hand="${m.hand}" data-foot="${m.foot}">${hands}${boots}<path d="M${48 - m.neck} ${m.y + 4}q${m.neck} 5 ${m.neck * 2} 0" fill="none" stroke="${ramp.skinLight}" stroke-width="1.1" opacity=".65"/></g>`;
};

export const femaleDetailLayer = ({ variant, palette, shape, direction }) => {
  const ramp = paletteRamp(palette);
  return `<g data-part="female-readability-layer" data-direction="${direction}">${feminineTorso(variant, ramp, shape)}${feminineGarment(variant, ramp, shape)}${feminineScaleDetails(ramp, shape)}</g>`;
};
