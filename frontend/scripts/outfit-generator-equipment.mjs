import { esc, has, index, paletteRamp } from './outfit-generator-utils.mjs';

const placement = (style, m, direction) => {
  if (m.facing < 0) return { x: 24, flip: -1 };
  if (m.facing > 0) return { x: 72, flip: 1 };
  const right = index(style, 2) === 1;
  return { x: right ? 74 : 22, flip: right ? 1 : -1 };
};

const grip = (x, flip, ramp, y = 83) => `<path d="M${x} ${y - 8}v28" stroke="${ramp.ink}" stroke-width="7"/><path d="M${x} ${y - 7}v26" stroke="${ramp.dark}" stroke-width="4"/><path d="M${x - 3} ${y - 3}h6M${x - 3} ${y + 5}h6M${x - 3} ${y + 13}h6" stroke="${ramp.accent}" stroke-width="1.5"/>`;

const sword = (style, ramp, x, flip, pose, long = false) => {
  const top = long ? 18 : 28;
  const guardY = 88 + pose.arm * 0.35;
  const bladeWidth = long ? 9 : 7;
  return `<path d="M${x} ${top}l${bladeWidth} ${guardY - top - 8}-${bladeWidth} 13-${bladeWidth}-13z" fill="${ramp.light}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${x} ${top + 5}v${guardY - top - 12}" stroke="${ramp.glow}" stroke-width="2"/><path d="M${x - bladeWidth + 2} ${top + 9}L${x} ${top + 4}v${guardY - top - 15}" fill="none" stroke="${ramp.shadow}" stroke-width="2"/><path d="M${x - 13} ${guardY}q13-7 26 0M${x - 10} ${guardY + 2}h20" fill="none" stroke="${ramp.accent}" stroke-width="5"/>${grip(x, flip, ramp, guardY + 2)}<circle cx="${x}" cy="${guardY + 29}" r="5" fill="${ramp.glow}" stroke="${ramp.ink}" stroke-width="2"/>`;
};

const axe = (style, ramp, x, flip, pose) => {
  const double = has(style, ['twin', 'double', 'battle']);
  const y = 49 + pose.arm * 0.25;
  return `<path d="M${x} ${y}v74" stroke="${ramp.ink}" stroke-width="8"/><path d="M${x} ${y + 1}v72" stroke="${ramp.dark}" stroke-width="4"/>${double ? `<path d="M${x} ${y + 5}q${flip * 25} -14 ${flip * 31} 9-10 13 ${-flip * 29} 10z" fill="${ramp.mid}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${x} ${y + 5}q${-flip * 25} -14 ${-flip * 31} 9 10 13 ${flip * 29} 10z" fill="${ramp.shadow}" stroke="${ramp.ink}" stroke-width="3"/>` : `<path d="M${x} ${y + 4}q${flip * 31} -17 ${flip * 34} 10-12 15 ${-flip * 31} 12z" fill="${ramp.mid}" stroke="${ramp.ink}" stroke-width="3"/>`}<path d="M${x + flip * 4} ${y + 9}q${flip * 18} -8 ${flip * 24} 4" fill="none" stroke="${ramp.light}" stroke-width="2"/><path d="M${x - 3} ${y + 48}h6M${x - 3} ${y + 57}h6M${x - 3} ${y + 66}h6" stroke="${ramp.accent}" stroke-width="2"/>`;
};

const mace = (style, ramp, x, pose) => {
  const hammer = has(style, ['hammer', 'maul']);
  const top = 34 + pose.arm * 0.2;
  const head = hammer
    ? `<path d="M${x - 18} ${top}h36v22h-36z" fill="${ramp.mid}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${x - 13} ${top + 4}h26v7h-26z" fill="${ramp.light}"/><path d="M${x - 18} ${top + 3}l-8 6 8 7M${x + 18} ${top + 3}l8 6-8 7" fill="${ramp.accent}" stroke="${ramp.ink}" stroke-width="2"/>`
    : `<circle cx="${x}" cy="${top + 10}" r="14" fill="${ramp.mid}" stroke="${ramp.ink}" stroke-width="3"/>${Array.from({ length: 8 }, (_, i) => { const a = (Math.PI * 2 * i) / 8; const x1 = x + Math.cos(a) * 12; const y1 = top + 10 + Math.sin(a) * 12; const x2 = x + Math.cos(a) * 20; const y2 = top + 10 + Math.sin(a) * 20; return `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${ramp.accent}" stroke-width="4"/>`; }).join('')}<circle cx="${x - 4}" cy="${top + 6}" r="4" fill="${ramp.light}"/>`;
  return `${head}<path d="M${x} ${top + 22}v70" stroke="${ramp.ink}" stroke-width="8"/><path d="M${x} ${top + 23}v68" stroke="${ramp.dark}" stroke-width="4"/><path d="M${x - 4} ${top + 54}h8M${x - 4} ${top + 65}h8M${x - 4} ${top + 76}h8" stroke="${ramp.accent}" stroke-width="2"/>`;
};

const staff = (style, ramp, x, pose) => {
  const crystal = has(style, ['crystal', 'star', 'void', 'sun', 'moon', 'orb', 'time', 'rune']);
  const y = 31 + pose.arm * 0.2;
  const crown = crystal
    ? `<polygon points="${x},${y - 18} ${x + 10},${y - 4} ${x + 5},${y + 9} ${x - 5},${y + 9} ${x - 10},${y - 4}" fill="${ramp.glow}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${x} ${y - 13}v17M${x - 6} ${y - 3}h12" stroke="${ramp.light}" stroke-width="2"/><ellipse cx="${x}" cy="${y - 2}" rx="17" ry="21" fill="none" stroke="${ramp.accent}" stroke-width="2" stroke-dasharray="3 4"/>`
    : `<circle cx="${x}" cy="${y - 2}" r="13" fill="${ramp.accent}" stroke="${ramp.ink}" stroke-width="3"/><circle cx="${x - 4}" cy="${y - 6}" r="4" fill="${ramp.light}"/><path d="M${x - 16} ${y - 2}q16-17 32 0" fill="none" stroke="${ramp.glow}" stroke-width="2"/>`;
  return `${crown}<path d="M${x} ${y + 9}v91" stroke="${ramp.ink}" stroke-width="8"/><path d="M${x} ${y + 10}v89" stroke="${ramp.base}" stroke-width="4"/><path d="M${x - 5} ${y + 34}h10M${x - 5} ${y + 49}h10M${x - 5} ${y + 64}h10" stroke="${ramp.accent}" stroke-width="2"/><path d="M${x - 5} ${y + 78}q5 7 10 0" fill="none" stroke="${ramp.light}" stroke-width="2"/>`;
};

const polearm = (style, ramp, x, flip, pose) => {
  const y = 22 + pose.arm * 0.2;
  return `<path d="M${x} ${y + 26}v101" stroke="${ramp.ink}" stroke-width="8"/><path d="M${x} ${y + 27}v99" stroke="${ramp.dark}" stroke-width="4"/><path d="M${x} ${y}q${flip * 27} 4 ${flip * 23} 27-12-5 ${-flip * 23} 4z" fill="${ramp.mid}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${x + flip * 3} ${y + 5}q${flip * 15} 4 ${flip * 15} 14" fill="none" stroke="${ramp.light}" stroke-width="2"/><path d="M${x} ${y + 1}l${-flip * 11} 18 ${flip * 11} 11" fill="${ramp.accent}" stroke="${ramp.ink}" stroke-width="2"/><path d="M${x - 4} ${y + 60}h8M${x - 4} ${y + 72}h8M${x - 4} ${y + 84}h8" stroke="${ramp.accent}" stroke-width="2"/>`;
};

const bow = (style, ramp, x, flip, pose) => {
  const crossbow = has(style, ['crossbow', 'arbalest']);
  const y = 70 + pose.arm * 0.35;
  if (crossbow) return `<path d="M${x - flip * 30} ${y - 9}q${flip * 30} -18 ${flip * 60} 0-14 14 ${-flip * 30} 13z" fill="none" stroke="${ramp.accent}" stroke-width="6"/><path d="M${x - flip * 30} ${y - 9}q${flip * 30} -10 ${flip * 60} 0" fill="none" stroke="${ramp.light}" stroke-width="2"/><path d="M${x - flip * 31} ${y - 9}h${flip * 62}" stroke="${ramp.glow}" stroke-width="1.5"/><path d="M${x} ${y - 18}v51" stroke="${ramp.ink}" stroke-width="9"/><path d="M${x} ${y - 17}v49" stroke="${ramp.dark}" stroke-width="5"/><path d="M${x} ${y - 9}h${flip * 41}" stroke="${ramp.glow}" stroke-width="2"/><path d="M${x + flip * 40} ${y - 13}l${flip * 10} 4-10 5z" fill="${ramp.light}"/><path d="M${x - 5} ${y + 21}h10" stroke="${ramp.accent}" stroke-width="3"/>`;
  const width = 27 + index(style, 8);
  return `<path d="M${x} 27q${flip * width} 43 0 93" fill="none" stroke="${ramp.ink}" stroke-width="9"/><path d="M${x} 28q${flip * width} 42 0 91" fill="none" stroke="${ramp.accent}" stroke-width="5"/><path d="M${x} 28q${flip * (width - 6)} 42 0 91" fill="none" stroke="${ramp.light}" stroke-width="2"/><path d="M${x} 28v91" stroke="${ramp.glow}" stroke-width="1.5"/><path d="M${x} ${y - 7}h${flip * 38}" stroke="${ramp.light}" stroke-width="2"/><path d="M${x + flip * 36} ${y - 11}l${flip * 11} 4-11 5z" fill="${ramp.glow}"/><path d="M${x + flip * 4} ${y - 12}v13" stroke="${ramp.dark}" stroke-width="5"/><path d="M${x + flip * 3} ${y - 9}v8" stroke="${ramp.accent}" stroke-width="2"/>`;
};

export const weapon = (style, characterClass, palette, m, direction, pose) => {
  const ramp = paletteRamp(palette);
  const { x, flip } = placement(style, m, direction);
  let artwork;
  if (characterClass === 'ARCHER' || has(style, ['bow', 'crossbow', 'arbalest'])) artwork = bow(style, ramp, x, flip, pose);
  else if (has(style, ['sword', 'blade', 'rapier', 'greatsword'])) artwork = sword(style, ramp, x, flip, pose, has(style, ['great', 'long', 'champion']));
  else if (has(style, ['axe', 'cleaver'])) artwork = axe(style, ramp, x, flip, pose);
  else if (has(style, ['mace', 'hammer', 'maul'])) artwork = mace(style, ramp, x, pose);
  else if (has(style, ['pole', 'glaive', 'spear', 'scythe', 'halberd'])) artwork = polearm(style, ramp, x, flip, pose);
  else artwork = staff(style, ramp, x, pose);
  return `<g data-part="weapon" data-style="${esc(style)}">${artwork}</g>`;
};

const shield = (style, ramp, x) => {
  const tower = has(style, ['tower', 'aegis', 'kite', 'great']);
  const width = tower ? 18 : 15;
  const height = tower ? 44 : 34;
  const top = 61;
  return `<path d="M${x - width} ${top}q${width} -13 ${width * 2} 0v${height - 8}q-${width} ${height / 2} ${-width * 2} 0z" fill="${ramp.dark}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${x - width + 4} ${top + 4}q${width - 4} -7 ${width * 2 - 8} 0v${height - 14}q-${width - 4} ${height / 2 - 3} ${-width * 2 + 8} 0z" fill="${ramp.base}"/><path d="M${x} ${top + 1}v${height + 3}M${x - width + 5} ${top + 15}h${width * 2 - 10}" stroke="${ramp.accent}" stroke-width="3"/><circle cx="${x}" cy="${top + 18}" r="7" fill="${ramp.mid}" stroke="${ramp.ink}" stroke-width="2"/><circle cx="${x - 2}" cy="${top + 16}" r="2" fill="${ramp.light}"/>`;
};

const book = (style, ramp, x) => `<path d="M${x - 15} 65q15-8 30 0v29q-15-8-30 0z" fill="${ramp.dark}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${x - 12} 68q12-5 12 1v22q-7-5-12-1zM${x} 69q0-6 12-1v22q-5-4-12 1z" fill="${ramp.light}"/><path d="M${x} 65v29M${x - 9} 74h7M${x - 9} 79h8M${x + 2} 74h8M${x + 2} 79h7" stroke="${ramp.accent}" stroke-width="1.5"/><polygon points="${x},72 ${x + 4},77 ${x},82 ${x - 4},77" fill="${ramp.glow}"/>`;

const orb = (style, ramp, x) => `<circle cx="${x}" cy="75" r="14" fill="${ramp.accent}" stroke="${ramp.ink}" stroke-width="3"/><circle cx="${x - 4}" cy="71" r="6" fill="${ramp.light}" opacity=".8"/><ellipse cx="${x}" cy="75" rx="20" ry="8" fill="none" stroke="${ramp.glow}" stroke-width="2" opacity=".75"/><path d="M${x - 7} 80q7-13 14 0" fill="none" stroke="${ramp.glow}" stroke-width="2"/>`;

const dagger = (style, ramp, x, flip) => `<path d="M${x} 60l${flip * 9} 30-9 13-7-13z" fill="${ramp.light}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${x} 65v24" stroke="${ramp.glow}" stroke-width="1.5"/><path d="M${x - 9} 91h18" stroke="${ramp.accent}" stroke-width="4"/><path d="M${x} 94v19" stroke="${ramp.dark}" stroke-width="5"/><circle cx="${x}" cy="115" r="4" fill="${ramp.glow}" stroke="${ramp.ink}" stroke-width="1.5"/>`;

export const offhand = (style, palette, m, direction, pose) => {
  const ramp = paletteRamp(palette);
  const primary = placement(style, m, direction);
  const x = m.facing !== 0 ? 48 - m.facing * 21 : primary.x > 48 ? 25 : 71;
  const flip = x > 48 ? 1 : -1;
  let artwork;
  if (has(style, ['shield', 'aegis'])) artwork = shield(style, ramp, x);
  else if (has(style, ['book', 'map', 'scroll', 'grimoire'])) artwork = book(style, ramp, x);
  else if (has(style, ['orb', 'seed', 'lantern', 'censer', 'focus'])) artwork = orb(style, ramp, x);
  else if (has(style, ['axe'])) artwork = axe(style, ramp, x, flip, pose);
  else if (has(style, ['trophy', 'skull'])) artwork = `<path d="M${x - 11} 65q11-12 22 0l-3 18-5 7-4-5-3 8-3-8-4 5-5-7z" fill="${ramp.light}" stroke="${ramp.ink}" stroke-width="3"/><circle cx="${x - 4}" cy="70" r="3" fill="${ramp.glow}"/><circle cx="${x + 4}" cy="70" r="3" fill="${ramp.glow}"/><path d="M${x - 5} 82h10" stroke="${ramp.dark}" stroke-width="2"/>`;
  else if (has(style, ['chain', 'gauntlet'])) artwork = `<path d="M${x} 61q-12 12 0 24t0 24" fill="none" stroke="${ramp.ink}" stroke-width="7"/><path d="M${x} 62q-10 11 0 22t0 22" fill="none" stroke="${ramp.accent}" stroke-width="3" stroke-dasharray="5 4"/><path d="M${x - 8} 105l8-5 8 5-3 11h-10z" fill="${ramp.mid}" stroke="${ramp.ink}" stroke-width="2"/>`;
  else artwork = dagger(style, ramp, x, flip);
  return `<g data-part="offhand" data-style="${esc(style)}">${artwork}</g>`;
};

const emblem = (type, ramp, y) => {
  const marks = [
    `<path d="M38 ${y}l10-10 10 10-10 11z" fill="${ramp.shadow}" stroke="${ramp.glow}" stroke-width="2"/><path d="M48 ${y - 7}v14M42 ${y}h12" stroke="${ramp.light}" stroke-width="1.5"/>`,
    `<path d="M36 ${y + 5}q12-19 24 0-12 15-24 0z" fill="${ramp.shadow}" stroke="${ramp.glow}" stroke-width="2"/><circle cx="48" cy="${y + 3}" r="4" fill="${ramp.accent}"/><circle cx="47" cy="${y + 2}" r="1.5" fill="${ramp.light}"/>`,
    `<path d="M37 ${y - 8}l22 18M59 ${y - 8}L37 ${y + 10}" stroke="${ramp.glow}" stroke-width="3"/><circle cx="48" cy="${y + 1}" r="4" fill="${ramp.accent}" stroke="${ramp.ink}" stroke-width="1.5"/>`,
    `<path d="M48 ${y - 13}v26m-11-16h22m-17 9h12" stroke="${ramp.glow}" stroke-width="3"/><circle cx="48" cy="${y - 13}" r="3" fill="${ramp.light}"/>`,
    `<path d="M36 ${y + 9}l6-20 6 13 6-13 6 20-12-5z" fill="${ramp.accent}" stroke="${ramp.glow}" stroke-width="2"/><circle cx="48" cy="${y + 1}" r="3" fill="${ramp.light}"/>`,
    `<circle cx="48" cy="${y}" r="11" fill="${ramp.shadow}" stroke="${ramp.glow}" stroke-width="2"/><path d="M48 ${y - 8}v8l7 4M40 ${y + 7}l4-5" stroke="${ramp.accent}" stroke-width="2"/>`,
  ];
  return marks[type];
};

export const detail = (style, palette, m, direction) => {
  const ramp = paletteRamp(palette);
  const y = m.y + 34;
  const type = index(style, 6);
  const beltY = 98;
  const pouches = direction === 'NORTH'
    ? `<rect x="31" y="${beltY + 3}" width="9" height="12" rx="2" fill="${ramp.dark}" stroke="${ramp.ink}" stroke-width="2"/><rect x="56" y="${beltY + 3}" width="9" height="12" rx="2" fill="${ramp.dark}" stroke="${ramp.ink}" stroke-width="2"/>`
    : `<rect x="29" y="${beltY + 3}" width="11" height="13" rx="2" fill="${ramp.dark}" stroke="${ramp.ink}" stroke-width="2"/><path d="M31 ${beltY + 7}h7" stroke="${ramp.light}" stroke-width="1.5"/><path d="M59 ${beltY + 2}q6 8 0 17" fill="none" stroke="${ramp.accent}" stroke-width="3"/>`;
  return `<g data-part="detail" data-style="${esc(style)}">${emblem(type, ramp, y)}<path d="M${48 - m.waist - 4} ${beltY}q${m.waist + 4} 5 ${m.waist * 2 + 8} 0" fill="none" stroke="${ramp.ink}" stroke-width="7"/><path d="M${48 - m.waist - 3} ${beltY - 1}q${m.waist + 3} 4 ${m.waist * 2 + 6} 0" fill="none" stroke="${ramp.accent}" stroke-width="3"/><rect x="43" y="${beltY - 5}" width="10" height="11" rx="2" fill="${ramp.mid}" stroke="${ramp.ink}" stroke-width="2"/><rect x="46" y="${beltY - 2}" width="4" height="5" fill="${ramp.glow}"/>${pouches}<path d="M38 ${beltY + 18}q10 7 20 0" fill="none" stroke="${ramp.light}" stroke-width="2" opacity=".65"/></g>`;
};
