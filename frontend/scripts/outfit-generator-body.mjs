import { esc, has, index, outline } from './outfit-generator-utils.mjs';

export const aura = (style, palette, seed) => {
  if (style === 'none') return '';
  const [, , accent, glow] = palette;
  const type = index(style, 5);
  return `<g data-part="aura" data-style="${esc(style)}">${Array.from({ length: 7 }, (_, i) => {
    const x = 10 + index(seed, 77, `ax${i}`);
    const y = 15 + index(seed, 105, `ay${i}`);
    if (type === 0) return `<path d="M${x} ${y + 5}q5-7 0-14q-5 7 0 14z" fill="${i % 2 ? glow : accent}" opacity=".45"/>`;
    if (type === 1) return `<path d="M${x - 4} ${y}h8M${x} ${y - 4}v8" stroke="${i % 2 ? glow : accent}" stroke-width="2" opacity=".5"/>`;
    if (type === 2) return `<path d="M${x} ${y + 6}q${i % 2 ? 8 : -8} -9 0-18" fill="none" stroke="${i % 2 ? glow : accent}" stroke-width="2" opacity=".45"/>`;
    if (type === 3) return `<polygon points="${x},${y - 5} ${x + 5},${y} ${x},${y + 5} ${x - 5},${y}" fill="none" stroke="${i % 2 ? glow : accent}" stroke-width="2" opacity=".5"/>`;
    return `<circle cx="${x}" cy="${y}" r="${1 + (i % 3)}" fill="${i % 2 ? glow : accent}" opacity=".5"/>`;
  }).join('')}</g>`;
};

export const back = (style, palette, seed) => {
  const [dark, base, accent, glow] = palette;
  if (style === 'none') return '';
  const type = index(style, 7);
  if (type === 0) return `<g data-part="back" data-style="${esc(style)}"><path d="M25 55q23-10 46 0l2 67-9-6-8 8-8-7-8 8-8-8-8 5z" fill="${base}" stroke="${dark}" stroke-width="3"/><path d="M29 62q19-8 38 0" stroke="${glow}" stroke-width="2" opacity=".5"/></g>`;
  if (type === 1) return `<g data-part="back" data-style="${esc(style)}"><path d="M32 59Q5 47 10 85q8-11 19-8-7 14 1 27 9-15 14-30zM64 59q27-12 22 26-8-11-19-8 7 14-1 27-9-15-14-30z" fill="${accent}" stroke="${dark}" stroke-width="3" opacity=".78"/></g>`;
  if (type === 2) return `<g data-part="back" data-style="${esc(style)}"><rect x="15" y="53" width="15" height="58" rx="5" fill="${base}" stroke="${dark}" stroke-width="3"/>${Array.from({ length: 5 }, (_, i) => `<path d="M18 ${55 + i * 2}l${i - 2} -20" stroke="${glow}" stroke-width="2"/>`).join('')}</g>`;
  if (type === 3) return `<g data-part="back" data-style="${esc(style)}"><path d="M20 46v78" stroke="${dark}" stroke-width="5"/><path d="M20 49h-17v54l17-9z" fill="${base}" stroke="${dark}" stroke-width="3"/><path d="M7 62h10" stroke="${glow}" stroke-width="3"/></g>`;
  if (type === 4) return `<g data-part="back" data-style="${esc(style)}">${Array.from({ length: 5 }, (_, i) => { const a = (Math.PI * 2 * i) / 5; const x = 48 + Math.cos(a) * 34; const y = 75 + Math.sin(a) * 45; return `<polygon points="${x},${y - 5} ${x + 5},${y} ${x},${y + 5} ${x - 5},${y}" fill="${i % 2 ? accent : base}" stroke="${dark}" stroke-width="2"/>`; }).join('')}</g>`;
  if (type === 5) return `<g data-part="back" data-style="${esc(style)}"><path d="M28 116Q8 94 18 57m-1 25-10-9m12-2 8-13M68 116q20-22 10-59m1 25 10-9m-12-2-8-13" fill="none" stroke="${base}" stroke-width="6"/><path d="M28 116Q8 94 18 57M68 116q20-22 10-59" fill="none" stroke="${glow}" stroke-width="2" opacity=".5"/></g>`;
  return `<g data-part="back" data-style="${esc(style)}"><rect x="18" y="55" width="18" height="42" rx="4" fill="${base}" stroke="${dark}" stroke-width="3"/><path d="M61 53v62m12-62v62" stroke="${base}" stroke-width="6"/><path d="M61 68h-9m21 0h9" stroke="${glow}" stroke-width="3"/></g>`;
};

export const legs = (garment, palette, m) => {
  const [dark, base, accent] = palette;
  const robe = has(garment, ['robe', 'gown', 'dress', 'regalia']);
  if (robe) return `<g data-part="legs"><path d="M${48 - m.hem} 88q${m.hem} -8 ${m.hem * 2} 0l-7 38-9-7-8 9-8-10-9 8z" fill="${base}" stroke="${dark}" stroke-width="3"/><path d="M37 119l-2 11h16l-1-11m7 0 2 11h16l-3-11" fill="${accent}" stroke="${dark}" stroke-width="3"/></g>`;
  return `<g data-part="legs"><path d="M31 91l2 37h14l2-37m-1 0 2 37h14l2-37" fill="${base}" stroke="${dark}" stroke-width="3"/><path d="M29 124h19v8H27zm22 0h19l2 8H51z" fill="#17191e"/></g>`;
};

export const garment = (style, palette, m, seed) => {
  const [dark, base, accent, glow] = palette;
  const type = index(style, 5);
  const left = 48 - m.shoulder;
  const right = 48 + m.shoulder;
  const wl = 48 - m.waist;
  const wr = 48 + m.waist;
  const paths = [
    `M${left} ${m.y + 6}Q48 ${m.y - 7} ${right} ${m.y + 6}L${wr + 5} 106Q48 114 ${wl - 5} 106z`,
    `M${left + 3} ${m.y + 3}Q48 ${m.y - 5} ${right - 3} ${m.y + 3}L${48 + m.hem} 108Q48 117 ${48 - m.hem} 108z`,
    `M${left + 1} ${m.y + 4}Q48 ${m.y - 5} ${right - 1} ${m.y + 4}L${wr + 7} 108L48 99L${wl - 7} 108z`,
    `M${left - 2} ${m.y + 6}Q48 ${m.y - 8} ${right + 2} ${m.y + 6}L${wr + 8} 104H${wl - 8}z`,
    `M${left + 5} ${m.y + 5}Q48 ${m.y - 2} ${right - 5} ${m.y + 5}L${wr + 3} 103Q48 109 ${wl - 3} 103z`,
  ];
  const panels = type === 3
    ? `<path d="M30 65h36M28 78h40M31 91h34M48 58v46" stroke="${accent}" stroke-width="3"/>`
    : type === 2
      ? `<path d="M48 59v46M34 67l14 10 14-10M32 88h32" fill="none" stroke="${accent}" stroke-width="3"/>`
      : `<path d="M35 67q13 9 26 0M32 82q16 10 32 0" fill="none" stroke="${accent}" stroke-width="3"/>`;
  return `<g data-part="garment" data-style="${esc(style)}"><path d="${paths[type]}" fill="${base}" stroke="${dark}" stroke-width="3"/><path d="M36 ${m.y + 7}l12 9 12-9" fill="none" stroke="${glow}" stroke-width="3"/>${panels}</g>`;
};

export const shoulders = (style, palette, m) => {
  const [dark, base, accent, glow] = palette;
  const type = index(style, 5);
  const y = m.y + 9;
  const lx = 48 - m.shoulder + 4;
  const rx = 48 + m.shoulder - 4;
  const part = (x, flip) => {
    if (type === 0) return `<path d="M${x} ${y + 9}l${flip * 14} -8 ${flip * 5} 13 ${-flip * 15} 4z" fill="${base}" stroke="${dark}" stroke-width="3"/>`;
    if (type === 1) return `<path d="M${x} ${y + 8}l${flip * 12} -9 ${flip * 10} 11 ${-flip * 17} 5z" fill="${accent}" stroke="${dark}" stroke-width="3"/><path d="M${x + flip * 10} ${y + 1}l${flip * 5} -10" stroke="${glow}" stroke-width="4"/>`;
    if (type === 2) return `<circle cx="${x + flip * 8}" cy="${y + 5}" r="10" fill="${base}" stroke="${dark}" stroke-width="3"/><circle cx="${x + flip * 8}" cy="${y + 5}" r="4" fill="${glow}"/>`;
    if (type === 3) return `<path d="M${x} ${y + 10}q${flip * 13} -15 ${flip * 25} -3 l${-flip * 9} 12z" fill="${accent}" stroke="${dark}" stroke-width="3"/>`;
    return `<path d="M${x} ${y + 10}l${flip * 17} -11 ${flip * 2} 18 ${-flip * 16} 2z" fill="${base}" stroke="${dark}" stroke-width="3"/><path d="M${x + flip * 13} ${y + 1}l${flip * 8} -12" stroke="${glow}" stroke-width="4"/>`;
  };
  return `<g data-part="shoulders" data-style="${esc(style)}">${part(lx, -1)}${part(rx, 1)}</g>`;
};

export const faceAndHead = (style, gender, palette, m, direction) => {
  const [dark, base, accent, glow, skin] = palette;
  const x = 48;
  const y = m.y - 18;
  const north = direction === 'NORTH';
  const type = index(style, 8);
  const face = `<ellipse cx="${x}" cy="${y}" rx="${m.head}" ry="18" fill="${skin}" stroke="${outline}" stroke-width="3"/>${north ? '' : `<circle cx="42" cy="${y + 1}" r="2" fill="${outline}"/><circle cx="54" cy="${y + 1}" r="2" fill="${outline}"/><path d="M43 ${y + 10}q5 3 10 0" fill="none" stroke="#8f604e" stroke-width="2"/>`}`;
  const hair = gender === 'FEMALE'
    ? `<path d="M${x - m.head} ${y - 4}q2 -20 ${m.head} -21 t${m.head} 21 l-3 29 -8 -16 -7 12 -7 -12 -7 16z" fill="${dark}" stroke="${outline}" stroke-width="2"/>`
    : `<path d="M${x - m.head} ${y - 4}q3 -20 ${m.head} -21 t${m.head} 21 l-7 -7 -8 5 -8 -5 -7 7z" fill="${dark}"/>`;
  let gear = hair;
  if (type === 0) gear = `<path d="M${x - m.head - 5} ${y + 10}Q${x - m.head} ${y - 24} ${x} ${y - 29}Q${x + m.head + 5} ${y - 18} ${x + m.head + 5} ${y + 12}l-9 18-8-14-8 12-8-14-9 16z" fill="${base}" stroke="${outline}" stroke-width="3"/>`;
  if (type === 1) gear = `<path d="M${x - m.head - 3} ${y + 10}Q${x - m.head} ${y - 22} ${x} ${y - 25}Q${x + m.head + 3} ${y - 16} ${x + m.head + 3} ${y + 10}L${x + 10} ${y + 22}H${x - 10}z" fill="${base}" stroke="${outline}" stroke-width="3"/><path d="M${x - 12} ${y - 2}h24" stroke="${glow}" stroke-width="3"/>`;
  if (type === 2) gear = `${hair}<path d="M${x - m.head + 2} ${y - 9}Q${x} ${y - 18} ${x + m.head - 2} ${y - 9}v19q${-m.head} 13 ${-(m.head * 2 - 4)} 0z" fill="${base}" stroke="${outline}" stroke-width="3"/><path d="M40 ${y}h5m6 0h5" stroke="${glow}" stroke-width="3"/>`;
  if (type === 3) gear = `${hair}<path d="M${x - m.head} ${y - 9}l5-13 8 8 7-15 7 15 8-8 5 13z" fill="${accent}" stroke="${outline}" stroke-width="3"/>`;
  if (type === 4) gear = `<path d="M${x - m.head - 4} ${y + 7}q3 -28 ${m.head + 4} -31 t${m.head + 4} 31z" fill="${base}" stroke="${outline}" stroke-width="3"/><path d="M${x - 10} ${y - 18}q-16 -14 -21 -6 m31 6 q16 -14 21 -6" fill="none" stroke="${accent}" stroke-width="5"/>`;
  if (type === 5) gear = `${hair}<ellipse cx="${x}" cy="${y - 23}" rx="${m.head + 7}" ry="9" fill="none" stroke="${glow}" stroke-width="4"/>`;
  if (type === 6) gear = `<path d="M${x - m.head - 4} ${y + 7}q3 -28 ${m.head + 4} -31 t${m.head + 4} 31z" fill="${base}" stroke="${outline}" stroke-width="3"/><path d="M${x - m.head + 2} ${y - 12}q-12 -15 -13 -27 11 8 20 25 m${m.head * 2 - 14} 2 q12 -15 13 -27 -11 8 -20 25" fill="${accent}" stroke="${outline}" stroke-width="3"/>`;
  if (type === 7) gear = `${hair}<path d="M${x - m.head - 5} ${y - 2}q${m.head + 5} -17 ${m.head * 2 + 10} 0 l-8 10 h-28z" fill="${base}" stroke="${outline}" stroke-width="3"/>`;
  return `<g data-part="head" data-style="${esc(style)}">${face}${gear}</g>`;
};
