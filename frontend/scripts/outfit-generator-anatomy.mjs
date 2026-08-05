import { esc, has, index, paletteRamp } from './outfit-generator-utils.mjs';

export const legs = (garmentStyle, palette, m, direction, pose) => {
  const ramp = paletteRamp(palette);
  const robe = has(garmentStyle, ['robe', 'gown', 'dress', 'regalia', 'cloak', 'coat-long', 'vestment']);
  const side = m.facing !== 0;
  const leftStride = side ? pose.stride * 0.45 : pose.stride;
  const rightStride = side ? -pose.stride * 0.25 : -pose.stride;
  if (robe) {
    const hem = Math.round(m.hem);
    return `<g data-part="legs" data-style="${esc(garmentStyle)}"><path d="M${48 - hem} 86Q48 80 ${48 + hem} 86L${48 + hem + 3 + pose.cloak} 118l-7 10-8-7-7 10-8-9-8 8-8-10-7 8-6-11z" fill="${ramp.shadow}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${48 - hem + 5} 88Q48 83 ${48 + hem - 5} 88L${48 + hem - 2 + pose.cloak} 116Q48 123 ${48 - hem + 2 + pose.cloak} 116z" fill="${ramp.base}"/><path d="M48 87v34M38 91q4 18 1 29M58 91q-4 18-1 29" fill="none" stroke="${ramp.mid}" stroke-width="2"/><path d="M${48 - hem + 5} 112q${hem - 5} 7 ${hem * 2 - 10} 0" fill="none" stroke="${ramp.light}" stroke-width="2"/><path d="M${48 - m.hip + 3} ${119 + leftStride}l-2 11h${m.foot + 7}l-1-12zM${48 + m.hip - m.foot - 8} ${118 + rightStride}l2 12h${m.foot + 7}l-3-12z" fill="${ramp.dark}" stroke="${ramp.ink}" stroke-width="2"/><path d="M${48 - m.hip + 3} ${126 + leftStride}h${m.foot + 4}M${48 + m.hip - m.foot - 5} ${126 + rightStride}h${m.foot + 3}" stroke="${ramp.accent}" stroke-width="2"/></g>`;
  }
  const leg = (x, offset, foreground) => `<g transform="translate(0 ${offset})"><path d="M${x - 8} 88l2 27-2 12h16l-2-12 2-27z" fill="${foreground ? ramp.base : ramp.shadow}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${x - 5} 91v22M${x + 4} 91v22" stroke="${ramp.mid}" stroke-width="2"/><path d="M${x - 9} 124h18l3 7h-24z" fill="${ramp.dark}" stroke="${ramp.ink}" stroke-width="2"/><path d="M${x - 6} 126h12" stroke="${ramp.light}" stroke-width="1.5"/></g>`;
  return `<g data-part="legs" data-style="${esc(garmentStyle)}">${leg(side ? 45 : 38, leftStride, pose.stride >= 0)}${leg(side ? 54 : 58, rightStride, pose.stride < 0)}<path d="M30 88h36" stroke="${ramp.accent}" stroke-width="3"/><circle cx="39" cy="91" r="3" fill="${ramp.light}"/><circle cx="57" cy="91" r="3" fill="${ramp.light}"/></g>`;
};

const garmentKind = (style) => {
  if (has(style, ['plate', 'armor', 'mail', 'scale'])) return 'plate';
  if (has(style, ['robe', 'gown', 'dress', 'regalia', 'vestment'])) return 'robe';
  if (has(style, ['coat', 'cloak', 'mantle', 'jacket'])) return 'coat';
  if (has(style, ['fur', 'hide', 'leather', 'pelt', 'wrap'])) return 'leather';
  return 'cloth';
};

export const garment = (style, palette, m, seed, direction) => {
  const ramp = paletteRamp(palette);
  const kind = garmentKind(style);
  const type = index(style, 5);
  const left = Math.round(48 - m.shoulder);
  const right = Math.round(48 + m.shoulder);
  const chestLeft = Math.round(48 - m.chest);
  const chestRight = Math.round(48 + m.chest);
  const wl = Math.round(48 - m.waist);
  const wr = Math.round(48 + m.waist);
  const hl = Math.round(48 - m.hip);
  const hr = Math.round(48 + m.hip);
  const neck = m.y + 2;
  const body = m.gender === 'FEMALE'
    ? `M${left} ${neck + 9}Q48 ${neck - 5} ${right} ${neck + 9}L${chestRight} ${neck + 28}Q${wr} ${neck + 43} ${wr} 88Q${hr} 99 ${hr + 2} 106Q48 114 ${hl - 2} 106Q${wl} 99 ${wl} 88Q${chestLeft} ${neck + 43} ${chestLeft} ${neck + 28}z`
    : `M${left} ${neck + 9}Q48 ${neck - 5} ${right} ${neck + 9}L${wr + 6} 106Q48 114 ${wl - 6} 106z`;
  const under = m.gender === 'FEMALE'
    ? `<path d="M${left + 4} ${neck + 8}Q48 ${neck} ${right - 4} ${neck + 8}L${chestRight - 2} ${neck + 28}Q${wr + 1} 82 ${wr + 1} 90Q${hr - 2} 101 ${hr - 1} 104Q48 109 ${hl + 1} 104Q${wl - 1} 101 ${wl - 1} 90Q${chestLeft + 2} 82 ${chestLeft + 2} ${neck + 28}z" fill="${ramp.base}"/>`
    : `<path d="M${left + 4} ${neck + 8}Q48 ${neck} ${right - 4} ${neck + 8}L${wr + 1} 105Q48 109 ${wl - 1} 105z" fill="${ramp.base}"/>`;
  const sideShadows = m.gender === 'FEMALE'
    ? `<path d="M${chestLeft + 1} ${neck + 16}q6 14 ${wl - chestLeft} 31q${hl - wl} 15 ${hl - 2} 38l-8 7-7-8zM${chestRight - 1} ${neck + 16}q-6 14 ${wr - chestRight} 31q${hr - wr} 15 ${hr + 2} 38l8 7 7-8z" fill="${ramp.shadow}" opacity=".72"/>`
    : `<path d="M${left + 2} ${neck + 12}q7 11 8 39l8 27-10 14-10-8zM${right - 2} ${neck + 12}q-7 11-8 39l-8 27 10 14 10-8z" fill="${ramp.shadow}" opacity=".78"/>`;
  let construction = '';
  if (kind === 'plate') {
    construction = `<path d="M35 ${neck + 10}l13 7 13-7 7 13-4 18H32l-4-18z" fill="${ramp.mid}" stroke="${ramp.ink}" stroke-width="2"/><path d="M34 ${neck + 34}h28l4 19-7 16H37l-7-16z" fill="${ramp.base}" stroke="${ramp.ink}" stroke-width="2"/><path d="M48 ${neck + 18}v49M35 ${neck + 43}h26M39 ${neck + 55}h18" stroke="${ramp.light}" stroke-width="2"/><path d="M31 ${neck + 26}l9-4M65 ${neck + 26}l-9-4" stroke="${ramp.dark}" stroke-width="3"/>${Array.from({ length: 6 }, (_, i) => `<circle cx="${35 + (i % 3) * 13}" cy="${neck + 39 + Math.floor(i / 3) * 21}" r="2" fill="${ramp.glow}" stroke="${ramp.ink}" stroke-width="1"/>`).join('')}`;
  } else if (kind === 'robe') {
    construction = `<path d="M35 ${neck + 7}l13 13 13-13 8 11-10 19H37L27 ${neck + 18}z" fill="${ramp.mid}" stroke="${ramp.ink}" stroke-width="2"/><path d="M48 ${neck + 20}v57M34 ${neck + 31}q14 8 28 0M31 ${neck + 49}q17 10 34 0" fill="none" stroke="${ramp.light}" stroke-width="2"/><path d="M40 ${neck + 17}l8 10 8-10" fill="${ramp.dark}" stroke="${ramp.ink}" stroke-width="1.5"/><path d="M29 ${neck + 62}l12-4 7 9 7-9 12 4" fill="none" stroke="${ramp.accent}" stroke-width="3"/>`;
  } else if (kind === 'coat') {
    construction = `<path d="M35 ${neck + 6}l13 12 13-12 8 9-10 17H37L27 ${neck + 15}z" fill="${ramp.mid}" stroke="${ramp.ink}" stroke-width="2"/><path d="M48 ${neck + 18}v59M31 ${neck + 33}h34M34 ${neck + 48}h28" stroke="${ramp.light}" stroke-width="2"/><path d="M31 ${neck + 55}l17 13 17-13" fill="none" stroke="${ramp.accent}" stroke-width="3"/>${Array.from({ length: 4 }, (_, i) => `<circle cx="48" cy="${neck + 28 + i * 11}" r="2" fill="${i % 2 ? ramp.glow : ramp.accent}" stroke="${ramp.ink}" stroke-width="1"/>`).join('')}`;
  } else if (kind === 'leather') {
    construction = `<path d="M34 ${neck + 10}l14 8 14-8 8 13-10 14H36L26 ${neck + 23}z" fill="${ramp.mid}" stroke="${ramp.ink}" stroke-width="2"/><path d="M29 ${neck + 31}l38 36M67 ${neck + 31}L29 ${neck + 67}" stroke="${ramp.accent}" stroke-width="4"/><path d="M31 ${neck + 32}l34 32M65 ${neck + 32}L31 ${neck + 64}" stroke="${ramp.light}" stroke-width="1.5"/>${Array.from({ length: 8 }, (_, i) => `<path d="M${30 + (i % 4) * 12} ${neck + 42 + Math.floor(i / 4) * 18}l4 2-4 2" fill="none" stroke="${ramp.glow}" stroke-width="1.5"/>`).join('')}`;
  } else {
    construction = `<path d="M35 ${neck + 9}l13 10 13-10" fill="none" stroke="${ramp.light}" stroke-width="3"/><path d="M48 ${neck + 18}v58M33 ${neck + 34}q15 8 30 0M31 ${neck + 53}q17 9 34 0" fill="none" stroke="${ramp.mid}" stroke-width="2"/><path d="M39 ${neck + 25}l9 7 9-7" fill="none" stroke="${ramp.accent}" stroke-width="2"/>`;
  }
  const trim = type % 2 === 0
    ? `<path d="M${left + 5} ${neck + 11}Q48 ${neck + 1} ${right - 5} ${neck + 11}" fill="none" stroke="${ramp.glow}" stroke-width="2"/><path d="M${wl - 2} 101q${m.waist + 2} 6 ${m.waist * 2 + 4} 0" fill="none" stroke="${ramp.light}" stroke-width="2"/>`
    : `<path d="M${left + 6} ${neck + 15}l10 8M${right - 6} ${neck + 15}l-10 8" stroke="${ramp.glow}" stroke-width="2"/><path d="M${wl} 99h${m.waist * 2}" stroke="${ramp.light}" stroke-width="3"/>`;
  return `<g data-part="garment" data-style="${esc(style)}" data-material="${kind}"><path d="${body}" fill="${ramp.dark}" stroke="${ramp.ink}" stroke-width="3"/>${under}${sideShadows}${construction}${trim}</g>`;
};

export const arms = (garmentStyle, palette, m, direction, pose) => {
  const ramp = paletteRamp(palette);
  const armored = garmentKind(garmentStyle) === 'plate';
  const side = m.facing !== 0;
  const visibleX = 48 + m.facing * (m.shoulder + 2);
  const hiddenX = 48 - m.facing * (m.shoulder - 4);
  const arm = (x, swing, visible) => {
    const sign = x < 48 ? -1 : 1;
    const upperY = m.y + 17;
    const elbowX = x + sign * (7 + swing * 0.45);
    const elbowY = upperY + 22 + Math.abs(swing) * 0.25;
    const handX = elbowX - sign * (2 + swing * 0.25);
    const handY = elbowY + 24 - swing * 0.6;
    return `<g opacity="${visible ? 1 : 0.72}"><path d="M${x} ${upperY}Q${elbowX} ${elbowY - 8} ${elbowX} ${elbowY}Q${handX} ${handY - 8} ${handX} ${handY}" fill="none" stroke="${ramp.ink}" stroke-width="13" stroke-linecap="round"/><path d="M${x} ${upperY}Q${elbowX} ${elbowY - 8} ${elbowX} ${elbowY}Q${handX} ${handY - 8} ${handX} ${handY}" fill="none" stroke="${armored ? ramp.mid : ramp.base}" stroke-width="9" stroke-linecap="round"/><path d="M${x + sign * 2} ${upperY + 2}Q${elbowX} ${elbowY - 10} ${elbowX - sign} ${elbowY + 2}" fill="none" stroke="${ramp.light}" stroke-width="2"/><path d="M${elbowX - sign * 5} ${elbowY - 2}l${sign * 10} 2" stroke="${ramp.accent}" stroke-width="3"/><ellipse cx="${handX}" cy="${handY + 2}" rx="${m.hand}" ry="${m.hand + 1}" fill="${ramp.skin}" stroke="${ramp.ink}" stroke-width="2"/></g>`;
  };
  if (side) return `<g data-part="arms">${arm(hiddenX, -pose.arm * 0.45, false)}${arm(visibleX, pose.arm, true)}</g>`;
  return `<g data-part="arms">${arm(48 - m.shoulder + 2, pose.arm, pose.arm <= 0)}${arm(48 + m.shoulder - 2, -pose.arm, pose.arm > 0)}</g>`;
};

export const shoulders = (style, palette, m) => {
  const ramp = paletteRamp(palette);
  const y = m.y + 10;
  const lx = Math.round(48 - m.shoulder + 3);
  const rx = Math.round(48 + m.shoulder - 3);
  const semantic = has(style, ['fur', 'pelt']) ? 'fur'
    : has(style, ['wing', 'feather']) ? 'wing'
      : has(style, ['spike', 'horn', 'hook', 'thorn', 'bone']) ? 'spike'
        : has(style, ['shawl', 'mantle', 'cloth', 'pad', 'leather']) ? 'soft'
          : 'plate';
  const part = (x, flip) => {
    if (semantic === 'fur') return `<path d="M${x} ${y + 10}q${flip * 10} -17 ${flip * 25} -7l${-flip * 4} 7 6 4-7 4 5 6-16 2z" fill="${ramp.shadow}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${x + flip * 5} ${y + 3}q${flip * 8} 3 ${flip * 14} 0" fill="none" stroke="${ramp.light}" stroke-width="2"/>`;
    if (semantic === 'wing') return `<path d="M${x} ${y + 9}q${flip * 11} -18 ${flip * 29} -11-6 8-2 13-8-2-12 8z" fill="${ramp.base}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${x + flip * 5} ${y + 5}l${flip * 17} -8M${x + flip * 7} ${y + 9}l${flip * 14} -2" stroke="${ramp.light}" stroke-width="2"/>`;
    if (semantic === 'spike') return `<path d="M${x} ${y + 11}l${flip * 16} -12 ${flip * 10} 10 ${-flip * 8} 10 ${-flip * 18} 1z" fill="${ramp.mid}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${x + flip * 10} ${y + 2}l${flip * 7} -16 ${flip * 4} 18" fill="${ramp.accent}" stroke="${ramp.ink}" stroke-width="2"/><path d="M${x + flip * 5} ${y + 10}l${flip * 12} -5" stroke="${ramp.light}" stroke-width="2"/>`;
    if (semantic === 'soft') return `<path d="M${x} ${y + 11}q${flip * 11} -14 ${flip * 25} -4l${-flip * 7} 14-18 2z" fill="${ramp.base}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${x + flip * 5} ${y + 8}q${flip * 8} -7 ${flip * 15} -4" fill="none" stroke="${ramp.light}" stroke-width="2"/><path d="M${x + flip * 13} ${y + 4}v12" stroke="${ramp.accent}" stroke-width="2"/>`;
    return `<path d="M${x} ${y + 12}q${flip * 12} -17 ${flip * 27} -7l${-flip * 5} 15-19 4z" fill="${ramp.mid}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${x + flip * 4} ${y + 10}q${flip * 10} -10 ${flip * 18} -6" fill="none" stroke="${ramp.light}" stroke-width="2"/><circle cx="${x + flip * 13}" cy="${y + 6}" r="3" fill="${ramp.glow}" stroke="${ramp.ink}" stroke-width="1.5"/>`;
  };
  return `<g data-part="shoulders" data-style="${esc(style)}">${part(lx, -1)}${part(rx, 1)}</g>`;
};
