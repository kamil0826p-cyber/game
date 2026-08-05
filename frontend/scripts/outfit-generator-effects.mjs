import { esc, has, index, paletteRamp } from './outfit-generator-utils.mjs';

const particles = (style, ramp, seed, frame) => {
  const type = index(style, 5);
  return Array.from({ length: 8 }, (_, i) => {
    const side = i % 2 ? 1 : -1;
    const x = 48 + side * (34 + index(seed, 9, `particle-x-${i}`));
    const y = 20 + index(seed, 88, `particle-y-${i}`) + ((i + frame) % 3) - 1;
    const color = i % 3 === 0 ? ramp.glow : i % 2 ? ramp.light : ramp.accent;
    const opacity = 0.28 + (i % 3) * 0.08;
    if (type === 0) return `<path d="M${x} ${y + 5}q4-6 0-12q-4 6 0 12z" fill="${color}" opacity="${opacity}"/>`;
    if (type === 1) return `<path d="M${x - 3} ${y}h6M${x} ${y - 3}v6" stroke="${color}" stroke-width="1.2" opacity="${opacity}"/>`;
    if (type === 2) return `<path d="M${x} ${y + 5}q${side * 7}-8 0-16" fill="none" stroke="${color}" stroke-width="1.6" opacity="${opacity}"/>`;
    if (type === 3) return `<polygon points="${x},${y - 4} ${x + 3},${y} ${x},${y + 4} ${x - 3},${y}" fill="none" stroke="${color}" stroke-width="1.2" opacity="${opacity}"/>`;
    return `<circle cx="${x}" cy="${y}" r="${1 + i % 2}" fill="${color}" opacity="${opacity}"/>`;
  }).join('');
};

export const aura = (style, palette, seed, frame) => {
  if (style === 'none') return '';
  const ramp = paletteRamp(palette);
  const orbit = index(style, 3) === 0
    ? `<ellipse cx="48" cy="91" rx="38" ry="48" fill="none" stroke="${ramp.accent}" stroke-width="1.2" stroke-dasharray="3 6" opacity=".18" transform="rotate(${frame * 8 - 12} 48 91)"/>`
    : '';
  const ground = `<ellipse cx="48" cy="128" rx="34" ry="8" fill="none" stroke="${ramp.glow}" stroke-width="1.7" opacity=".2"/>`;
  return `<g data-part="aura" data-style="${esc(style)}" data-body-overlap="0">${orbit}${ground}${particles(style, ramp, seed, frame)}</g>`;
};

const cape = (style, ramp, m, pose) => {
  const width = Math.round(m.shoulder + 9);
  const left = 48 - width;
  const right = 48 + width;
  const sway = pose.cloak;
  const ragged = has(style, ['ragged', 'torn', 'black', 'void', 'blood', 'rot', 'pelt']);
  const hem = ragged
    ? `${left + 4 + sway} 123 ${left + 13 + sway} 116 ${left + 20 + sway} 126 48 118 ${right - 20 + sway} 127 ${right - 12 + sway} 116 ${right - 3 + sway} 123`
    : `${left + 3 + sway} 124 48 129 ${right - 3 + sway} 124`;
  return `<path d="M${left} 56Q48 45 ${right} 56L${right - 2 + sway} 112L${hem}L${left + 2 + sway} 112z" fill="${ramp.shadow}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${left + 5} 60Q48 52 ${right - 5} 60L${right - 8 + sway} 112Q48 119 ${left + 8 + sway} 112z" fill="${ramp.base}"/><path d="M48 57v61M36 63q3 31 1 48M60 63q-3 31-1 48" fill="none" stroke="${ramp.mid}" stroke-width="1.7" opacity=".58"/><path d="M${left + 8} 62Q48 53 ${right - 8} 62" fill="none" stroke="${ramp.light}" stroke-width="1.7" opacity=".6"/>`;
};

const wings = (ramp, pose) => {
  const feather = (side) => Array.from({ length: 5 }, (_, i) => {
    const x = 48 + side * (14 + i * 5);
    const y = 62 + i * 8 + pose.cloak;
    return `<path d="M${x} ${y}q${side * 20} ${4 + i * 2} ${side * 24} ${23 - i}q${-side * 13}-5 ${-side * 22} 3q${side * 3}-12 ${-side * 2}-26z" fill="${i % 2 ? ramp.base : ramp.accent}" stroke="${ramp.ink}" stroke-width="2"/><path d="M${x + side * 3} ${y + 3}q${side * 12} 8 ${side * 17} ${17 - i}" fill="none" stroke="${ramp.light}" stroke-width="1.3" opacity=".65"/>`;
  }).join('');
  return `${feather(-1)}${feather(1)}`;
};

const quiver = (style, ramp, pose) => {
  const x = index(style, 2) ? 23 : 68;
  const flip = x > 48 ? 1 : -1;
  return `<g transform="rotate(${flip * (8 + pose.cloak)} ${x} 79)"><path d="M${x - 8} 56l16-2 2 58-14 8-10-10z" fill="${ramp.base}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${x - 5} 61l10-1 1 48-8 5z" fill="${ramp.shadow}"/><path d="M${x - 7} 66l14-2M${x - 5} 101l11-1" stroke="${ramp.accent}" stroke-width="2"/>${Array.from({ length: 5 }, (_, i) => `<path d="M${x - 4 + i * 2} 56l${(i - 2) * 2}-22" stroke="${i % 2 ? ramp.light : ramp.mid}" stroke-width="1.7"/><path d="M${x - 8 + i * 2} ${36 - i}l4 3-5 2" fill="${ramp.accent}"/>`).join('')}</g>`;
};

const banner = (style, ramp, pose) => {
  const x = index(style, 2) ? 22 : 74;
  return `<path d="M${x} 31v96" stroke="${ramp.dark}" stroke-width="5"/><path d="M${x} 32v95" stroke="${ramp.mid}" stroke-width="2"/><path d="M${x} 37h${x < 48 ? 31 : -31}v54l${x < 48 ? -8 : 8} 10-8-7-8 8-7-11z" fill="${ramp.base}" stroke="${ramp.ink}" stroke-width="3" transform="skewY(${pose.cloak})"/><path d="M${x < 48 ? x + 5 : x - 5} 47h${x < 48 ? 21 : -21}M${x < 48 ? x + 5 : x - 5} 56h${x < 48 ? 18 : -18}" stroke="${ramp.light}" stroke-width="1.7" opacity=".6"/>`;
};

const trophyBack = (_style, ramp, pose) =>
  `<g transform="translate(0 ${pose.cloak})"><path d="M38 66q10-11 20 0l-4 21-6 7-6-7z" fill="${ramp.shadow}" stroke="${ramp.ink}" stroke-width="3"/><circle cx="43" cy="72" r="2" fill="${ramp.glow}"/><circle cx="53" cy="72" r="2" fill="${ramp.glow}"/></g>`;

export const back = (style, palette, seed, m, direction, pose) => {
  if (style === 'none') return '';
  const ramp = paletteRamp(palette);
  let artwork;
  if (has(style, ['wing', 'feather'])) artwork = wings(ramp, pose);
  else if (has(style, ['quiver', 'bolt', 'arrow'])) artwork = quiver(style, ramp, pose);
  else if (has(style, ['banner', 'standard'])) artwork = banner(style, ramp, pose);
  else if (has(style, ['antler', 'trophy'])) artwork = trophyBack(style, ramp, pose);
  else if (has(style, ['pack', 'case', 'rack'])) {
    artwork = `<path d="M22 58q11-9 20 0l-2 56-12 8-11-9z" fill="${ramp.base}" stroke="${ramp.ink}" stroke-width="3"/><path d="M25 65h14M23 86h16M27 59v58" stroke="${ramp.accent}" stroke-width="1.7"/><rect x="18" y="73" width="9" height="23" rx="3" fill="${ramp.shadow}" stroke="${ramp.ink}" stroke-width="2"/><circle cx="33" cy="75" r="3" fill="${ramp.light}"/>`;
  } else if (has(style, ['halo', 'orbit', 'orb', 'rune'])) {
    artwork = `<ellipse cx="48" cy="70" rx="32" ry="39" fill="none" stroke="${ramp.accent}" stroke-width="3" opacity=".55"/><ellipse cx="48" cy="70" rx="25" ry="32" fill="none" stroke="${ramp.glow}" stroke-width="1.2" stroke-dasharray="2 5" opacity=".7"/>${Array.from({ length: 4 }, (_, i) => { const a = (Math.PI * 2 * i) / 4 + pose.cloak * 0.03; const x = 48 + Math.cos(a) * 32; const y = 70 + Math.sin(a) * 39; return `<polygon points="${x},${y - 4} ${x + 3},${y} ${x},${y + 4} ${x - 3},${y}" fill="${i % 2 ? ramp.glow : ramp.accent}" stroke="${ramp.ink}" stroke-width="1.2"/>`; }).join('')}`;
  } else if (has(style, ['spine', 'thorn', 'branch'])) {
    artwork = `<path d="M48 48v78" stroke="${ramp.dark}" stroke-width="6"/><path d="M48 52v70" stroke="${ramp.mid}" stroke-width="2"/>${Array.from({ length: 4 }, (_, i) => `<path d="M48 ${61 + i * 14}l${i % 2 ? 18 : -18}-9" stroke="${ramp.base}" stroke-width="4"/><path d="M48 ${61 + i * 14}l${i % 2 ? 18 : -18}-9" stroke="${ramp.light}" stroke-width="1.2" opacity=".5"/>`).join('')}`;
  } else artwork = cape(style, ramp, m, pose);
  return `<g data-part="back" data-style="${esc(style)}" opacity="${direction === 'SOUTH' ? 0.88 : 1}">${artwork}</g>`;
};
