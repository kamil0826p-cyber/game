import { esc, index } from './outfit-generator-utils.mjs';

export const weapon = (style, characterClass, palette) => {
  const [dark, base, accent, glow] = palette;
  const type = index(style, characterClass === 'ARCHER' ? 4 : 7);
  const x = index(style, 2) ? 75 : 21;
  const flip = x > 48 ? 1 : -1;
  if (characterClass === 'ARCHER') {
    if (type === 3) return `<g data-part="weapon" data-style="${esc(style)}"><path d="M${x} 58q${flip * 25} -18 ${flip * 43} 0 ${-flip * 21} 13 ${-flip * 43} 0z" fill="none" stroke="${accent}" stroke-width="6"/><path d="M${x} 53v45" stroke="${base}" stroke-width="7"/><path d="M${x - flip * 25} 58h${flip * 51}" stroke="${glow}" stroke-width="2"/></g>`;
    return `<g data-part="weapon" data-style="${esc(style)}"><path d="M${x} 28q${flip * (28 + type * 3)} 45 0 91" fill="none" stroke="${accent}" stroke-width="6"/><path d="M${x} 28q${-flip * (24 + type * 2)} 45 0 91" fill="none" stroke="${base}" stroke-width="4"/><path d="M${x} 28v91" stroke="${glow}" stroke-width="2"/><path d="M${x - flip * 3} 72h${flip * 32}" stroke="${glow}" stroke-width="3"/><path d="M${x + flip * 28} 68l${flip * 10} 4 ${-flip * 10} 5z" fill="${glow}"/></g>`;
  }
  if (type === 0) return `<g data-part="weapon" data-style="${esc(style)}"><path d="M${x} 40v82" stroke="${base}" stroke-width="6"/><circle cx="${x}" cy="34" r="10" fill="${accent}" stroke="${glow}" stroke-width="3"/></g>`;
  if (type === 1) return `<g data-part="weapon" data-style="${esc(style)}"><path d="M${x} 34v88" stroke="${base}" stroke-width="6"/><path d="M${x} 18l11 18-11 10-11-10z" fill="${glow}" stroke="${dark}" stroke-width="3"/></g>`;
  if (type === 2) return `<g data-part="weapon" data-style="${esc(style)}"><path d="M${x} 28l${flip * 12} 58 ${-flip * 5} 23 ${-flip * 7} -23z" fill="${glow}" stroke="${dark}" stroke-width="3"/><path d="M${x - flip * 12} 91h${flip * 24}M${x} 91v31" stroke="${base}" stroke-width="6"/></g>`;
  if (type === 3) return `<g data-part="weapon" data-style="${esc(style)}"><path d="M${x} 50v72" stroke="${base}" stroke-width="6"/><path d="M${x - flip * 4} 32q${flip * 28} 3 ${flip * 22} 28 -13 -8 ${-flip * 22} -8z" fill="${glow}" stroke="${dark}" stroke-width="3"/></g>`;
  if (type === 4) return `<g data-part="weapon" data-style="${esc(style)}"><rect x="${x - 14}" y="29" width="28" height="21" rx="3" fill="${accent}" stroke="${dark}" stroke-width="3"/><path d="M${x} 48v74" stroke="${base}" stroke-width="7"/></g>`;
  if (type === 5) return `<g data-part="weapon" data-style="${esc(style)}"><circle cx="${x}" cy="61" r="13" fill="${accent}" stroke="${glow}" stroke-width="3"/><circle cx="${x - 4}" cy="57" r="4" fill="${glow}"/></g>`;
  return `<g data-part="weapon" data-style="${esc(style)}"><path d="M${x} 31v91" stroke="${base}" stroke-width="6"/><path d="M${x} 18l${flip * 13} 19-13 9-10-9z" fill="${glow}" stroke="${dark}" stroke-width="3"/></g>`;
};

export const offhand = (style, palette) => {
  const [dark, base, accent, glow] = palette;
  const type = index(style, 4);
  const x = index(style, 2) ? 69 : 27;
  if (type === 0) return `<g data-part="offhand" data-style="${esc(style)}"><path d="M${x - 14} 65q14-13 28 0v28q-14 13-28 0z" fill="${base}" stroke="${dark}" stroke-width="3"/><path d="M${x} 63v40M${x - 10} 82h20" stroke="${accent}" stroke-width="3"/><circle cx="${x}" cy="82" r="5" fill="${glow}"/></g>`;
  if (type === 1) return `<g data-part="offhand" data-style="${esc(style)}"><path d="M${x - 13} 66q13-7 26 0v24q-13-7-26 0z" fill="${base}" stroke="${dark}" stroke-width="3"/><path d="M${x} 64v28" stroke="${glow}" stroke-width="2"/></g>`;
  if (type === 2) return `<g data-part="offhand" data-style="${esc(style)}"><circle cx="${x}" cy="73" r="10" fill="${accent}" stroke="${glow}" stroke-width="3"/></g>`;
  return `<g data-part="offhand" data-style="${esc(style)}"><path d="M${x} 59l8 31-8 10-6-35z" fill="${glow}" stroke="${dark}" stroke-width="3"/><path d="M${x - 7} 89h17" stroke="${accent}" stroke-width="4"/></g>`;
};

export const detail = (style, palette, m) => {
  const [dark, , accent, glow] = palette;
  const y = m.y + 33;
  const type = index(style, 6);
  const marks = [
    `<path d="M38 ${y}l10-9 10 9-10 10z" fill="none" stroke="${glow}" stroke-width="3"/>`,
    `<path d="M36 ${y + 5}q12-18 24 0-12 15-24 0z" fill="none" stroke="${glow}" stroke-width="3"/><circle cx="48" cy="${y + 3}" r="3" fill="${accent}"/>`,
    `<path d="M37 ${y - 7}l22 17M59 ${y - 7}L37 ${y + 10}" stroke="${glow}" stroke-width="3"/>`,
    `<path d="M48 ${y - 11}v23m-10-14h20m-16 8h12" stroke="${glow}" stroke-width="3"/>`,
    `<path d="M37 ${y + 9}l5-18 6 12 6-12 5 18z" fill="${accent}" stroke="${glow}" stroke-width="2"/>`,
    `<circle cx="48" cy="${y}" r="10" fill="none" stroke="${glow}" stroke-width="3"/><path d="M48 ${y - 8}v8l6 4" stroke="${accent}" stroke-width="2"/>`,
  ][type];
  return `<g data-part="detail" data-style="${esc(style)}">${marks}<path d="M34 ${y + 16}h28" stroke="${dark}" stroke-width="5"/></g>`;
};
