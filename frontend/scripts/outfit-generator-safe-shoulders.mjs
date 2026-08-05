import { esc, has, paletteRamp } from './outfit-generator-utils.mjs';

const shoulderKind = (style) => {
  if (has(style, ['fur', 'pelt', 'hide', 'moss'])) return 'soft';
  if (has(style, ['cloth', 'shawl', 'mantle', 'sleeve', 'collar', 'veil'])) return 'cloth';
  if (has(style, ['scale', 'lamellar', 'segment', 'stone', 'boulder'])) return 'segmented';
  return 'plate';
};

const frontPair = (style, palette, m, direction) => {
  const ramp = paletteRamp(palette);
  const kind = shoulderKind(style);
  const y = m.y + 12;
  const side = direction === 'WEST' || direction === 'EAST';
  const facing = direction === 'WEST' ? -1 : direction === 'EAST' ? 1 : 0;
  const leftX = Math.round(48 - m.shoulder + 4);
  const rightX = Math.round(48 + m.shoulder - 4);

  const cap = (x, flip, visible = true) => {
    const opacity = visible ? 1 : 0.62;
    if (kind === 'soft') {
      return `<g opacity="${opacity}"><path d="M${x} ${y + 8}q${flip * 8}-11 ${flip * 19}-7q${flip * 5} 4 ${flip * 2} 12q${-flip * 9} 5 ${-flip * 21} 2z" fill="${ramp.shadow}" stroke="${ramp.ink}" stroke-width="2.5"/><path d="M${x + flip * 4} ${y + 5}q${flip * 7}-5 ${flip * 12}-3" fill="none" stroke="${ramp.light}" stroke-width="1.4"/></g>`;
    }
    if (kind === 'cloth') {
      return `<g opacity="${opacity}"><path d="M${x} ${y + 8}q${flip * 9}-10 ${flip * 18}-5l${-flip * 3} 12q${-flip * 9} 3 ${-flip * 18} 0z" fill="${ramp.base}" stroke="${ramp.ink}" stroke-width="2.5"/><path d="M${x + flip * 3} ${y + 6}q${flip * 7}-4 ${flip * 12}-2" fill="none" stroke="${ramp.light}" stroke-width="1.3"/></g>`;
    }
    if (kind === 'segmented') {
      return `<g opacity="${opacity}"><path d="M${x} ${y + 9}q${flip * 7}-12 ${flip * 18}-8q${flip * 5} 5 ${flip * 2} 13q${-flip * 8} 4 ${-flip * 20} 1z" fill="${ramp.mid}" stroke="${ramp.ink}" stroke-width="2.5"/><path d="M${x + flip * 4} ${y + 5}q${flip * 6}-5 ${flip * 11}-3M${x + flip * 7} ${y + 9}q${flip * 5}-3 ${flip * 9}-1" fill="none" stroke="${ramp.light}" stroke-width="1.2"/></g>`;
    }
    return `<g opacity="${opacity}"><path d="M${x} ${y + 9}q${flip * 7}-13 ${flip * 18}-8q${flip * 5} 4 ${flip * 3} 12q${-flip * 8} 6 ${-flip * 21} 2z" fill="${ramp.mid}" stroke="${ramp.ink}" stroke-width="2.5"/><path d="M${x + flip * 4} ${y + 5}q${flip * 7}-6 ${flip * 12}-3" fill="none" stroke="${ramp.light}" stroke-width="1.4"/><circle cx="${x + flip * 10}" cy="${y + 5}" r="2" fill="${ramp.glow}" stroke="${ramp.ink}" stroke-width=".8"/></g>`;
  };

  if (side) {
    const visibleX = facing < 0 ? leftX : rightX;
    const hiddenX = facing < 0 ? rightX : leftX;
    return `<g data-part="shoulders" data-style="${esc(style)}" data-shoulder-arrows="0">${cap(hiddenX, facing < 0 ? 1 : -1, false)}${cap(visibleX, facing, true)}</g>`;
  }
  return `<g data-part="shoulders" data-style="${esc(style)}" data-shoulder-arrows="0">${cap(leftX, -1, true)}${cap(rightX, 1, true)}</g>`;
};

export const safeShoulders = (style, palette, shape, direction) =>
  frontPair(style, palette, shape, direction);
