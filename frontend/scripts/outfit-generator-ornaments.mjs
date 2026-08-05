import { esc, index, paletteRamp } from './outfit-generator-utils.mjs';

const classMotif = (characterClass, ramp, y) => {
  if (characterClass === 'MAGE') {
    return `<g data-part="ornament-class-motif"><circle cx="48" cy="${y}" r="7" fill="${ramp.shadow}" stroke="${ramp.glow}" stroke-width="1.2"/><circle cx="48" cy="${y}" r="3.5" fill="none" stroke="${ramp.light}" stroke-width="1"/><circle cx="48" cy="${y}" r="1.5" fill="${ramp.glow}"/></g>`;
  }
  if (characterClass === 'WARRIOR') {
    return `<g data-part="ornament-class-motif"><path d="M40 ${y - 5}q8-5 16 0v8q-8 8-16 0z" fill="${ramp.shadow}" stroke="${ramp.light}" stroke-width="1.2"/><circle cx="48" cy="${y + 1}" r="2.5" fill="${ramp.accent}"/><path d="M43 ${y + 5}q5 3 10 0" fill="none" stroke="${ramp.glow}" stroke-width="1"/></g>`;
  }
  return `<g data-part="ornament-class-motif"><ellipse cx="48" cy="${y}" rx="8" ry="5" fill="${ramp.shadow}" stroke="${ramp.light}" stroke-width="1.2"/><path d="M42 ${y}q6-7 12 0q-6 7-12 0z" fill="none" stroke="${ramp.accent}" stroke-width="1"/><circle cx="48" cy="${y}" r="1.5" fill="${ramp.glow}"/></g>`;
};

const garmentTrim = (ramp, shape) => {
  const left = 48 - shape.waist;
  const right = 48 + shape.waist;
  const hipLeft = 48 - shape.hip;
  const hipRight = 48 + shape.hip;
  return `<g data-part="ornament-garment-trim"><path d="M${left} 95q${shape.waist} 4 ${shape.waist * 2} 0" fill="none" stroke="${ramp.glow}" stroke-width="1.1"/><path d="M${hipLeft + 3} 107q${shape.hip - 3} 5 ${shape.hip * 2 - 6} 0" fill="none" stroke="${ramp.light}" stroke-width="1.1" opacity=".65"/><circle cx="${left + 3}" cy="96" r="1.2" fill="${ramp.accent}"/><circle cx="${right - 3}" cy="96" r="1.2" fill="${ramp.accent}"/><circle cx="${hipLeft + 6}" cy="108" r="1" fill="${ramp.glow}"/><circle cx="${hipRight - 6}" cy="108" r="1" fill="${ramp.glow}"/></g>`;
};

const jewelry = (variant, ramp, shape) => {
  const style = index(`${variant.head}|${variant.detail}`, 4);
  if (style === 0) {
    return `<g data-part="ornament-jewelry"><path d="M${48 - shape.neck} ${shape.y + 7}q${shape.neck} 7 ${shape.neck * 2} 0" fill="none" stroke="${ramp.light}" stroke-width="1.2"/><ellipse cx="48" cy="${shape.y + 17}" rx="3" ry="4" fill="${ramp.glow}" stroke="${ramp.ink}" stroke-width=".9"/></g>`;
  }
  if (style === 1) {
    return `<g data-part="ornament-jewelry"><circle cx="${48 - shape.shoulder + 7}" cy="${shape.y + 18}" r="2.2" fill="${ramp.glow}" stroke="${ramp.ink}" stroke-width=".8"/><circle cx="${48 + shape.shoulder - 7}" cy="${shape.y + 18}" r="2.2" fill="${ramp.glow}" stroke="${ramp.ink}" stroke-width=".8"/></g>`;
  }
  if (style === 2) {
    return `<g data-part="ornament-jewelry"><path d="M39 ${shape.y + 13}q9 6 18 0" fill="none" stroke="${ramp.light}" stroke-width="1.1"/><circle cx="48" cy="${shape.y + 18}" r="2.8" fill="${ramp.accent}" stroke="${ramp.ink}" stroke-width=".8"/></g>`;
  }
  return `<g data-part="ornament-jewelry"><path d="M40 ${shape.y + 13}q8 7 16 0" fill="none" stroke="${ramp.light}" stroke-width="1.1"/><ellipse cx="48" cy="${shape.y + 20}" rx="3.2" ry="2.5" fill="none" stroke="${ramp.glow}" stroke-width="1"/></g>`;
};

const directionSeams = (direction, ramp, shape) => {
  if (direction === 'WEST' || direction === 'EAST') {
    const side = direction === 'WEST' ? -1 : 1;
    return `<g data-part="ornament-direction"><path d="M${48 + side * 4} ${shape.y + 18}q${side * 7} 12 ${side * 6} 30" fill="none" stroke="${ramp.light}" stroke-width="1.1"/><circle cx="${48 + side * 8}" cy="${shape.y + 31}" r="1.5" fill="${ramp.accent}"/></g>`;
  }
  return `<g data-part="ornament-direction"><path d="M36 ${shape.y + 24}q12 6 24 0M35 ${shape.y + 41}q13 7 26 0" fill="none" stroke="${ramp.light}" stroke-width="1" opacity=".58"/></g>`;
};

export const ornamentDetailLayer = ({ design, variant, palette, shape, direction }) => {
  const ramp = paletteRamp(palette);
  return `<g data-part="ornament-detail-layer" data-style="${esc(variant.detail)}" data-random-strokes="0" data-shoulder-arrows="0">${garmentTrim(ramp, shape)}${classMotif(design.characterClass, ramp, shape.y + 40)}${jewelry(variant, ramp, shape)}${directionSeams(direction, ramp, shape)}</g>`;
};
