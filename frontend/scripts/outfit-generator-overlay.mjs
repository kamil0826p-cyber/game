import { esc, has, outline } from './outfit-generator-utils.mjs';

const material = (value) => has(value, ['plate', 'armor', 'mail', 'scale'])
  ? 'metal'
  : has(value, ['fur', 'pelt', 'hide'])
    ? 'fur'
    : has(value, ['leather', 'jerkin', 'vest'])
      ? 'leather'
      : 'cloth';

const torso = (variant, palette, m) => {
  const [dark, base, accent, glow] = palette;
  const kind = material(variant.garment);
  const left = Math.round(48 - m.waist - 5);
  const right = Math.round(48 + m.waist + 5);
  const top = Math.round(m.y + 14);
  const bottom = 104;
  let pattern = '';
  if (kind === 'metal') {
    pattern = `<path d="M34 ${top + 2}l14 8 14-8M32 ${top + 21}h32M35 ${top + 37}h26M48 ${top + 10}v43" fill="none" stroke="${glow}" stroke-width="1.4" opacity=".7"/>${[[37, top + 18], [59, top + 18], [38, top + 34], [58, top + 34]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.5" fill="${glow}" stroke="${outline}" stroke-width=".6"/>`).join('')}`;
  } else if (kind === 'fur') {
    pattern = [0, 1, 2, 3, 4].map((row) => `<path d="M${35 + row % 2 * 3} ${top + 5 + row * 8}l4 5 4-6 4 6 4-6 4 5" fill="none" stroke="${row % 2 ? accent : glow}" stroke-width="1.2" opacity=".65"/>`).join('');
  } else if (kind === 'leather') {
    pattern = `<path d="M35 ${top + 3}l26 ${bottom - top - 8}M61 ${top + 3}L35 ${bottom - 5}" stroke="${accent}" stroke-width="1.2" stroke-dasharray="3 3" opacity=".68"/>${[top + 13, top + 28, top + 43].map((y) => `<path d="M34 ${y}h28" stroke="${dark}" stroke-width="1.2"/>`).join('')}`;
  } else {
    pattern = [36, 42, 48, 54, 60].map((x, i) => `<path d="M${x} ${top + 2}q${i % 2 ? 3 : -3} 18 ${i % 2 ? 1 : -1} ${bottom - top - 6}" fill="none" stroke="${i === 2 ? glow : accent}" stroke-width="1.1" opacity=".55"/>`).join('');
  }
  return `<g data-part="advanced-torso" data-material="${kind}" data-random-strokes="0"><clipPath id="torso-${esc(variant.detail)}"><path d="M${left} ${top}Q48 ${top - 8} ${right} ${top}L${right - 2} ${bottom}Q48 ${bottom + 7} ${left + 2} ${bottom}z"/></clipPath><g clip-path="url(#torso-${esc(variant.detail)})">${pattern}</g><path d="M${left} 94q${48 - left} 5 ${right - left} 0" fill="none" stroke="${outline}" stroke-width="6"/><path d="M${left + 1} 94q${47 - left} 4 ${right - left - 2} 0" fill="none" stroke="${accent}" stroke-width="2.5"/><rect x="43" y="90" width="10" height="10" rx="2" fill="${base}" stroke="${outline}" stroke-width="2"/><rect x="46" y="93" width="4" height="4" fill="${glow}"/></g>`;
};

const arms = (variant, palette, m, direction) => {
  const [, base, accent, glow, skin = '#c79572'] = palette;
  const side = direction === 'WEST';
  const points = side ? [[70, 1, 1], [34, -1, .55]] : [[26, -1, 1], [70, 1, 1]];
  return `<g data-part="advanced-arms">${points.map(([x, flip, opacity]) => `<g opacity="${opacity}"><path d="M${x} ${m.y + 23}q${flip * 7} 15 ${flip * 4} 35" fill="none" stroke="${outline}" stroke-width="11" stroke-linecap="round"/><path d="M${x} ${m.y + 23}q${flip * 7} 15 ${flip * 4} 35" fill="none" stroke="${material(variant.garment) === 'metal' ? accent : base}" stroke-width="7" stroke-linecap="round"/><path d="M${x + flip} ${m.y + 25}q${flip * 5} 13 ${flip * 3} 24" fill="none" stroke="${glow}" stroke-width="1.2" opacity=".55"/><circle cx="${x + flip * 4}" cy="${m.y + 60}" r="4.5" fill="${skin}" stroke="${outline}" stroke-width="2"/></g>`).join('')}</g>`;
};

const trim = (palette, m) => {
  const [, , accent, glow] = palette;
  return `<g data-part="advanced-trim"><path d="M36 ${m.y + 12}l12 8 12-8" fill="none" stroke="${glow}" stroke-width="1.5"/><path d="M38 ${m.y + 43}q10 5 20 0" fill="none" stroke="${accent}" stroke-width="1.2"/><circle cx="48" cy="${m.y + 34}" r="3" fill="${accent}" stroke="${outline}" stroke-width="1"/><circle cx="48" cy="${m.y + 34}" r="1" fill="${glow}"/></g>`;
};

export const advancedDetailLayer = ({ variant, shape, direction, design }) =>
  `<g data-part="advanced-detail-layer" data-style="${esc(variant.detail)}" data-random-strokes="0" data-duplicates-head="0" data-duplicates-weapon="0">${torso(variant, design.palette, shape)}${arms(variant, design.palette, shape, direction)}${trim(design.palette, shape)}</g>`;
