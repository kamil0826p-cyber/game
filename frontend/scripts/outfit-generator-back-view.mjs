import { esc, has, headgearAllowsHair, headgearMode, index, paletteRamp } from './outfit-generator-utils.mjs';

const garmentKind = (style) => {
  if (has(style, ['plate', 'armor', 'mail', 'scale', 'lamellar', 'stone'])) return 'plate';
  if (has(style, ['robe', 'gown', 'dress', 'regalia', 'habit', 'vestment'])) return 'robe';
  if (has(style, ['coat', 'cloak', 'mantle', 'jacket'])) return 'coat';
  if (has(style, ['fur', 'hide', 'leather', 'pelt'])) return 'leather';
  return 'cloth';
};

const rearAura = (style, ramp, seed, frame) => {
  if (style === 'none') return '<g data-part="back-aura"/>';
  const phase = frame % 2 ? 2 : -2;
  const motes = Array.from({ length: 8 }, (_, i) => {
    const side = i % 2 ? 1 : -1;
    const x = 48 + side * (31 + index(seed, 10, `rear-aura-x-${i}`));
    const y = 23 + index(seed, 89, `rear-aura-y-${i}`) + (i % 3) * phase;
    return i % 3 === 0
      ? `<circle cx="${x}" cy="${y}" r="${1 + (i % 2)}" fill="${ramp.glow}" opacity=".34"/>`
      : `<path d="M${x - 2} ${y}h4M${x} ${y - 2}v4" stroke="${ramp.accent}" stroke-width="1" opacity=".32"/>`;
  }).join('');
  return `<g data-part="back-aura" data-body-overlap="0">${motes}</g>`;
};

const rearLegs = (variant, ramp, m, pose) => {
  const robe = garmentKind(variant.garment) === 'robe' || garmentKind(variant.garment) === 'coat';
  if (robe) {
    const hem = Math.round(m.hem);
    return `<g data-part="back-legs"><path d="M${48 - hem} 87q${hem} -6 ${hem * 2} 0l${pose.cloak + 2} 31-7 10-8-6-7 9-8-8-8 8-8-9-7 7-5-30z" fill="${ramp.shadow}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${48 - hem + 4} 89q${hem - 4}-4 ${hem * 2 - 8} 0l${pose.cloak} 27q-${hem - 5} 7 ${-(hem * 2 - 10)} 0z" fill="${ramp.base}"/><path d="M39 92q2 16 0 28M48 90v31M57 92q-2 16 0 28" fill="none" stroke="${ramp.mid}" stroke-width="1.7"/><path d="M${48 - m.hip + 3} ${119 + pose.stride}h${m.foot + 7}v10H${48 - m.hip + 1}zM${48 + m.hip - m.foot - 10} ${119 - pose.stride}h${m.foot + 7}l2 10H${48 + m.hip - m.foot - 10}z" fill="${ramp.dark}" stroke="${ramp.ink}" stroke-width="2"/></g>`;
  }
  return `<g data-part="back-legs"><path d="M31 88h16l1 28-3 13H30l3-13zM49 88h16l3 28-1 13H52l-3-13z" fill="${ramp.base}" stroke="${ramp.ink}" stroke-width="3"/><path d="M35 91v25M43 91v25M53 91v25M61 91v25" stroke="${ramp.mid}" stroke-width="1.7"/><path d="M29 124h18l2 7H27zM50 124h18l2 7H50z" fill="${ramp.dark}" stroke="${ramp.ink}" stroke-width="2"/><path d="M32 126h12M54 126h12" stroke="${ramp.light}" stroke-width="1.2"/></g>`;
};

const rearGarment = (variant, ramp, m) => {
  const kind = garmentKind(variant.garment);
  const left = Math.round(48 - m.shoulder);
  const right = Math.round(48 + m.shoulder);
  const waistLeft = Math.round(48 - m.waist);
  const waistRight = Math.round(48 + m.waist);
  const hipLeft = Math.round(48 - m.hip);
  const hipRight = Math.round(48 + m.hip);
  const backShape = m.gender === 'FEMALE'
    ? `M${left} ${m.y + 11}Q48 ${m.y + 1} ${right} ${m.y + 11}L${48 + m.chest} ${m.y + 37}Q${waistRight} 84 ${waistRight} 93Q${hipRight} 104 ${hipRight + 1} 109Q48 114 ${hipLeft - 1} 109Q${waistLeft} 104 ${waistLeft} 93Q${48 - m.chest} 84 ${48 - m.chest} ${m.y + 37}z`
    : `M${left} ${m.y + 11}Q48 ${m.y + 1} ${right} ${m.y + 11}L${waistRight + 6} 108Q48 114 ${waistLeft - 6} 108z`;
  const material = kind === 'plate'
    ? `<g data-part="back-material"><path d="M35 ${m.y + 18}q13-8 26 0l4 20-6 15H37l-6-15z" fill="${ramp.mid}" stroke="${ramp.ink}" stroke-width="2"/><path d="M48 ${m.y + 19}v34M36 ${m.y + 32}h24M39 ${m.y + 44}h18" stroke="${ramp.light}" stroke-width="1.5"/>${[37, 48, 59].map((x) => `<circle cx="${x}" cy="${m.y + 27}" r="1.5" fill="${ramp.glow}" stroke="${ramp.ink}" stroke-width=".6"/>`).join('')}</g>`
    : kind === 'leather'
      ? `<g data-part="back-material"><path d="M33 ${m.y + 18}l30 38M63 ${m.y + 18}L33 ${m.y + 56}" stroke="${ramp.accent}" stroke-width="3"/><path d="M35 ${m.y + 20}l26 34M61 ${m.y + 20}L35 ${m.y + 54}" stroke="${ramp.light}" stroke-width="1.2" stroke-dasharray="3 3"/></g>`
      : `<g data-part="back-material"><path d="M37 ${m.y + 18}q11-5 22 0M34 ${m.y + 34}q14-6 28 0M32 ${m.y + 51}q16-6 32 0" fill="none" stroke="${ramp.light}" stroke-width="1.4" opacity=".65"/><path d="M48 ${m.y + 16}v49" stroke="${ramp.mid}" stroke-width="1.2"/></g>`;
  return `<g data-part="back-garment" data-style="${esc(variant.garment)}" data-facing="back"><path d="${backShape}" fill="${ramp.dark}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${left + 4} ${m.y + 12}Q48 ${m.y + 5} ${right - 4} ${m.y + 12}L${waistRight + 1} 105Q48 110 ${waistLeft - 1} 105z" fill="${ramp.base}" opacity=".9"/>${material}<g data-part="back-belt"><path d="M${waistLeft - 2} 92q${m.waist + 2} 4 ${m.waist * 2 + 4} 0" fill="none" stroke="${ramp.ink}" stroke-width="5"/><path d="M${waistLeft - 1} 92q${m.waist + 1} 3 ${m.waist * 2 + 2} 0" fill="none" stroke="${ramp.accent}" stroke-width="2"/><rect x="44" y="89" width="8" height="8" rx="2" fill="${ramp.mid}" stroke="${ramp.ink}" stroke-width="1.5"/></g></g>`;
};

const rearArms = (variant, ramp, m, pose) => {
  const armored = garmentKind(variant.garment) === 'plate';
  const arm = (x, flip, swing) => {
    const elbowX = x + flip * (4 + swing * .35);
    const handX = elbowX - flip * 2;
    return `<g><path d="M${x} ${m.y + 21}q${flip * 7} 17 ${elbowX - x} 33q${-flip * 2} 15 ${handX - elbowX} 24" fill="none" stroke="${ramp.ink}" stroke-width="12" stroke-linecap="round"/><path d="M${x} ${m.y + 21}q${flip * 7} 17 ${elbowX - x} 33q${-flip * 2} 15 ${handX - elbowX} 24" fill="none" stroke="${armored ? ramp.mid : ramp.base}" stroke-width="8" stroke-linecap="round"/><path d="M${x + flip} ${m.y + 23}q${flip * 4} 14 ${elbowX - x - flip} 26" fill="none" stroke="${ramp.light}" stroke-width="1.4"/><ellipse cx="${handX}" cy="${m.y + 79}" rx="${m.hand}" ry="${m.hand + 1}" fill="${ramp.skin}" stroke="${ramp.ink}" stroke-width="2"/></g>`;
  };
  return `<g data-part="back-arms">${arm(48 - m.shoulder + 3, -1, pose.arm)}${arm(48 + m.shoulder - 3, 1, -pose.arm)}</g>`;
};

const rearShoulders = (style, ramp, m) => {
  const soft = has(style, ['cloth', 'shawl', 'mantle', 'fur', 'pelt', 'sleeve', 'collar']);
  const cap = (x, flip) => soft
    ? `<path d="M${x} ${m.y + 21}q${flip * 8}-11 ${flip * 19}-6q${flip * 4} 4 ${flip * 1} 11q${-flip * 9} 4 ${-flip * 20} 1z" fill="${ramp.shadow}" stroke="${ramp.ink}" stroke-width="2.5"/><path d="M${x + flip * 4} ${m.y + 17}q${flip * 6}-4 ${flip * 11}-2" fill="none" stroke="${ramp.light}" stroke-width="1.3"/>`
    : `<path d="M${x} ${m.y + 21}q${flip * 7}-12 ${flip * 18}-7q${flip * 5} 4 ${flip * 2} 12q${-flip * 8} 5 ${-flip * 20} 1z" fill="${ramp.mid}" stroke="${ramp.ink}" stroke-width="2.5"/><path d="M${x + flip * 4} ${m.y + 17}q${flip * 7}-5 ${flip * 12}-2" fill="none" stroke="${ramp.light}" stroke-width="1.3"/>`;
  return `<g data-part="back-shoulders" data-shoulder-arrows="0">${cap(48 - m.shoulder + 4, -1)}${cap(48 + m.shoulder - 4, 1)}</g>`;
};

const rearHead = (style, gender, ramp, m, pose) => {
  const mode = headgearMode(style);
  const y = m.y - 18;
  const width = m.head + 5;
  const rearHair = gender === 'FEMALE'
    ? `<g data-part="back-hair"><path d="M${48 - width} ${y - 4}q2-21 ${width}-24t${width} 24l-2 ${32 + pose.hair}q-${Math.round(width * .55)} 9-${width - 2} 5q-${Math.round(width * .5)} 5-${width - 2}-5l-2-${32 + pose.hair}z" fill="${ramp.hair}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${48 - width + 7} ${y - 13}q${width - 7}-9 ${width * 2 - 14} 0M${48 - width + 9} ${y + 1}q-1 14 2 27M${48 + width - 9} ${y + 1}q1 14-2 27" fill="none" stroke="${ramp.hairLight}" stroke-width="1.5" opacity=".65"/></g>`
    : `<g data-part="back-hair"><path d="M${48 - width + 2} ${y - 3}q2-20 ${width - 2}-22t${width - 2} 22l-5 15-7-7-7 7-7-7-5 7z" fill="${ramp.hair}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${48 - width + 8} ${y - 12}q${width - 8}-7 ${width * 2 - 16} 0" fill="none" stroke="${ramp.hairLight}" stroke-width="1.4"/></g>`;

  if (mode === 'full') {
    return `<g data-part="back-head" data-face-elements="0" data-visible-hair="0"><path d="M${48 - width} ${y + 11}q2-31 ${width}-36t${width} 36l-5 16-8-8-7 9-7-9-8 8z" fill="${ramp.mid}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${48 - width + 5} ${y - 4}q${width - 5}-16 ${width * 2 - 10} 0v18q-${width - 5} 8-${width * 2 - 10} 0z" fill="${ramp.base}"/><path d="M48 ${y - 8}v30M39 ${y + 4}h18M42 ${y + 14}h12" stroke="${ramp.light}" stroke-width="1.6"/><circle cx="48" cy="${y + 2}" r="2" fill="${ramp.glow}"/></g>`;
  }
  if (mode === 'hood') {
    return `<g data-part="back-head" data-face-elements="0" data-visible-hair="0"><path d="M${48 - width} ${y + 18}q-2-33 ${width}-40t${width} 40l-7 15-8-7-7 9-7-9-8 7z" fill="${ramp.shadow}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${48 - width + 5} ${y + 11}q0-25 ${width - 5}-31t${width - 5} 31q-${width - 5} 10-${width * 2 - 10} 0z" fill="${ramp.base}"/><path d="M${48 - width + 7} ${y - 3}q${width - 7}-16 ${width * 2 - 14} 0M39 ${y + 10}q9 5 18 0" fill="none" stroke="${ramp.light}" stroke-width="1.5"/></g>`;
  }
  if (mode === 'hat') {
    return `<g data-part="back-head" data-face-elements="0" data-visible-hair="1">${rearHair}<ellipse cx="48" cy="${y - 9}" rx="${width + 8}" ry="7" fill="${ramp.dark}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${48 - width + 2} ${y - 12}q4-28 ${width - 2}-35 12 9 ${width - 1} 36z" fill="${ramp.base}" stroke="${ramp.ink}" stroke-width="3"/><path d="M36 ${y - 13}h24" stroke="${ramp.accent}" stroke-width="3"/></g>`;
  }
  return `<g data-part="back-head" data-face-elements="0" data-visible-hair="${headgearAllowsHair(style) ? 1 : 0}">${rearHair}${mode === 'ornamental' ? `<path d="M${48 - width + 5} ${y - 10}q${width - 5}-7 ${width * 2 - 10} 0" fill="none" stroke="${ramp.accent}" stroke-width="4"/><circle cx="48" cy="${y - 12}" r="3" fill="${ramp.glow}" stroke="${ramp.ink}" stroke-width="1"/>` : ''}</g>`;
};

const rearEquipment = (variant, ramp) => {
  const style = variant.back;
  if (style === 'none') return '<g data-part="back-equipment"/>';
  if (has(style, ['quiver', 'bolt', 'arrow', 'magazine'])) {
    return `<g data-part="back-equipment" data-style="${esc(style)}"><path d="M59 55q8-3 14 2l-3 57-8 7-8-8z" fill="${ramp.base}" stroke="${ramp.ink}" stroke-width="3"/>${Array.from({ length: 6 }, (_, i) => `<path d="M${59 + i * 2} 58l${i - 3}-${23 + i}" stroke="${i % 2 ? ramp.light : ramp.accent}" stroke-width="1.5"/>`).join('')}<path d="M58 67h12M57 83h13" stroke="${ramp.mid}" stroke-width="1.4"/></g>`;
  }
  if (has(style, ['cape', 'cloak', 'mantle', 'train', 'veil', 'ribbon'])) {
    return `<g data-part="back-equipment" data-style="${esc(style)}"><path d="M29 57q19-9 38 0l4 65-8-6-7 8-8-7-8 8-7-8-8 5z" fill="${ramp.shadow}" stroke="${ramp.ink}" stroke-width="3" opacity=".9"/><path d="M34 63q14-6 28 0M37 68q2 27 0 48M48 64v54M59 68q-2 27 0 48" fill="none" stroke="${ramp.light}" stroke-width="1.4" opacity=".58"/></g>`;
  }
  if (has(style, ['pack', 'case', 'satchel', 'basket', 'tablet', 'clockcase', 'furnace'])) {
    return `<g data-part="back-equipment" data-style="${esc(style)}"><rect x="31" y="57" width="34" height="53" rx="8" fill="${ramp.base}" stroke="${ramp.ink}" stroke-width="3"/><rect x="35" y="63" width="26" height="39" rx="5" fill="${ramp.shadow}"/><path d="M37 71h22M37 88h22M42 59v49M54 59v49" stroke="${ramp.light}" stroke-width="1.3"/><circle cx="48" cy="79" r="4" fill="${ramp.accent}" stroke="${ramp.ink}" stroke-width="1"/></g>`;
  }
  if (has(style, ['wing', 'feather'])) {
    return `<g data-part="back-equipment" data-style="${esc(style)}"><path d="M37 59Q13 52 13 92q9-9 18-5-5 14 4 25 7-16 13-38zM59 59q24-7 24 33-9-9-18-5 5 14-4 25-7-16-13-38z" fill="${ramp.base}" stroke="${ramp.ink}" stroke-width="3" opacity=".82"/><path d="M34 65q-12 9-15 27M62 65q12 9 15 27" fill="none" stroke="${ramp.light}" stroke-width="1.4"/></g>`;
  }
  if (has(style, ['banner', 'standard', 'pennant'])) {
    return `<g data-part="back-equipment" data-style="${esc(style)}"><path d="M24 42v82" stroke="${ramp.ink}" stroke-width="5"/><path d="M24 44v80" stroke="${ramp.accent}" stroke-width="2"/><path d="M26 49h24v36l-12-5-12 7z" fill="${ramp.base}" stroke="${ramp.ink}" stroke-width="3"/><circle cx="37" cy="65" r="6" fill="${ramp.shadow}" stroke="${ramp.light}" stroke-width="1.2"/></g>`;
  }
  return `<g data-part="back-equipment" data-style="${esc(style)}"><ellipse cx="48" cy="78" rx="18" ry="24" fill="${ramp.shadow}" stroke="${ramp.ink}" stroke-width="3"/><path d="M36 78q12-13 24 0-12 13-24 0z" fill="${ramp.base}" stroke="${ramp.light}" stroke-width="1.4"/><circle cx="48" cy="78" r="4" fill="${ramp.glow}" stroke="${ramp.ink}" stroke-width="1"/></g>`;
};

const rearWeapon = (variant, characterClass, ramp) => {
  if (characterClass === 'ARCHER' || has(variant.weapon, ['bow', 'crossbow', 'sling'])) {
    return `<g data-part="back-weapon" data-style="${esc(variant.weapon)}"><path d="M22 33q-16 39 0 83M22 34v82" fill="none" stroke="${ramp.ink}" stroke-width="5"/><path d="M22 34q-12 38 0 81M22 35v80" fill="none" stroke="${ramp.accent}" stroke-width="2"/><path d="M17 72h10" stroke="${ramp.light}" stroke-width="1.3"/></g>`;
  }
  if (has(variant.weapon, ['staff', 'spear', 'lance', 'glaive', 'halberd', 'pole', 'crozier'])) {
    return `<g data-part="back-weapon" data-style="${esc(variant.weapon)}"><path d="M72 28l-14 95" stroke="${ramp.ink}" stroke-width="6"/><path d="M72 29l-14 93" stroke="${ramp.accent}" stroke-width="2.5"/><path d="M68 34l9-9 3 13-8 7z" fill="${ramp.light}" stroke="${ramp.ink}" stroke-width="2"/></g>`;
  }
  return `<g data-part="back-weapon" data-style="${esc(variant.weapon)}"><path d="M67 41l-27 76" stroke="${ramp.ink}" stroke-width="7"/><path d="M66 42l-26 74" stroke="${ramp.light}" stroke-width="2.5"/><path d="M61 40l8-8 5 11-8 8z" fill="${ramp.accent}" stroke="${ramp.ink}" stroke-width="2"/><path d="M35 112l10 4" stroke="${ramp.accent}" stroke-width="4"/></g>`;
};

const rearOrnament = (variant, ramp, m) => `<g data-part="back-ornament" data-style="${esc(variant.detail)}" data-shoulder-arrows="0"><path d="M38 ${m.y + 28}q10-5 20 0M36 ${m.y + 46}q12-5 24 0" fill="none" stroke="${ramp.light}" stroke-width="1" opacity=".55"/><path d="M48 ${m.y + 18}v39" stroke="${ramp.accent}" stroke-width="1" stroke-dasharray="3 3"/><circle cx="48" cy="${m.y + 40}" r="3" fill="${ramp.glow}" stroke="${ramp.ink}" stroke-width="1"/><g data-part="back-fasteners">${Array.from({ length: 10 }, (_, i) => `<circle cx="${39 + (i % 5) * 4.5}" cy="${m.y + 58 + Math.floor(i / 5) * 8}" r=".9" fill="${i % 2 ? ramp.light : ramp.accent}"/>`).join('')}<path d="M38 ${m.y + 61}h20M38 ${m.y + 69}h20" stroke="${ramp.shadow}" stroke-width=".8"/></g></g>`;

export const renderBackView = ({ design, gender, variant, shape, pose, seed, frame }) => {
  const ramp = paletteRamp(design.palette);
  const shadowWidth = Math.round(shape.hem + shape.shoulder * .35);
  return `<g data-part="back-view" data-facing="back" data-face-elements="0" data-shoulder-arrows="0">${rearAura(variant.aura, ramp, seed, frame)}<g data-part="back-ground-shadow"><ellipse cx="48" cy="131" rx="${shadowWidth}" ry="7" fill="#020306" opacity=".52"/><ellipse cx="48" cy="129" rx="${Math.max(13, shadowWidth - 8)}" ry="3" fill="#111622" opacity=".38"/></g>${rearLegs(variant, ramp, shape, pose)}${rearGarment(variant, ramp, shape)}${rearArms(variant, ramp, shape, pose)}${rearShoulders(variant.shoulders, ramp, shape)}${rearHead(variant.head, gender, ramp, shape, pose)}${rearEquipment(variant, ramp)}${rearWeapon(variant, design.characterClass, ramp)}${rearOrnament(variant, ramp, shape)}</g>`;
};
