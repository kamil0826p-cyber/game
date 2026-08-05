import { esc, has, index, outline } from './outfit-generator-utils.mjs';

const ramp = ([dark, base, accent, glow, skin = '#c79572']) => ({
  ink: outline,
  dark,
  base,
  accent,
  glow,
  skin,
});

const headMode = (style) => {
  if (has(style, ['helm', 'faceless'])) return 'full';
  if (has(style, ['hood'])) return 'hood';
  if (has(style, ['mask', 'veil'])) return 'mask';
  if (has(style, ['hat', 'brim'])) return 'hat';
  if (has(style, ['crown', 'circlet', 'tiara'])) return 'ornamental';
  return 'open';
};

const face = (gender, colors, m, direction) => {
  const y = m.y - 18;
  if (direction === 'NORTH') {
    return `<ellipse cx="48" cy="${y}" rx="${m.head}" ry="${gender === 'FEMALE' ? 16 : 18}" fill="${colors.skin}" stroke="${colors.ink}" stroke-width="3"/>`;
  }
  const side = direction === 'WEST';
  const eyes = side
    ? `<ellipse cx="42" cy="${y + 1}" rx="2.5" ry="2" fill="#ece4d8"/><circle cx="42" cy="${y + 1}" r="1" fill="${colors.glow}"/>`
    : `<ellipse cx="42" cy="${y + 1}" rx="2.5" ry="2" fill="#ece4d8"/><ellipse cx="54" cy="${y + 1}" rx="2.5" ry="2" fill="#ece4d8"/><circle cx="42" cy="${y + 1}" r="1" fill="${colors.glow}"/><circle cx="54" cy="${y + 1}" r="1" fill="${colors.glow}"/>`;
  const jaw = gender === 'FEMALE'
    ? `M${48 - m.head} ${y - 4}q1-12 ${m.head}-14t${m.head} 14q0 14-${m.head} 19q-${m.head}-5-${m.head}-19z`
    : `M${48 - m.head} ${y - 4}q1-13 ${m.head}-15t${m.head} 15q0 16-${m.head} 21q-${m.head}-5-${m.head}-21z`;
  return `<g data-part="portrait"><path d="${jaw}" fill="${colors.skin}" stroke="${colors.ink}" stroke-width="3"/><ellipse cx="43" cy="${y - 7}" rx="5" ry="3" fill="#fff4dc" opacity=".32"/>${eyes}<path d="M46 ${y + 10}q3 2 6 0" fill="none" stroke="#805947" stroke-width="1.2"/></g>`;
};

const hair = (gender, colors, m, direction) => {
  const y = m.y - 18;
  const width = m.head + (gender === 'FEMALE' ? 5 : 3);
  const rearLength = gender === 'FEMALE' ? 29 : 18;
  const rear = `<path d="M${48 - width} ${y - 4}q2-20 ${width}-23t${width} 23l-2 ${rearLength}q-${Math.round(width * .55)} 8-${width - 2} 4q-${Math.round(width * .5)} 5-${width - 2}-4l-2-${rearLength}z" fill="${colors.dark}" stroke="${colors.ink}" stroke-width="3"/>`;
  const fringe = `<path d="M${48 - width + 2} ${y - 5}q3-17 ${width - 2}-20t${width - 2} 20l-5-2-5 10-7-11-7 11-5-10-5 3z" fill="${colors.dark}" stroke="${colors.ink}" stroke-width="2"/>`;
  const highlights = `<path d="M${48 - width + 7} ${y - 12}q${width - 7}-10 ${width * 2 - 14} 0M${48 - width + 8} ${y + 1}q-1 12 2 21M${48 + width - 8} ${y + 1}q1 12-2 21" fill="none" stroke="${colors.accent}" stroke-width="1.7" opacity=".62"/>`;
  const sideLock = direction === 'WEST'
    ? `<path d="M${48 - width + 4} ${y + 2}q-3 12 2 23" fill="none" stroke="${colors.glow}" stroke-width="1.4" opacity=".55"/>`
    : '';
  return `<g data-part="hair" data-hair-bounded="true">${rear}${fringe}${highlights}${sideLock}</g>`;
};

export const faceAndHead = (style, gender, palette, m, direction) => {
  const colors = ramp(palette);
  const mode = headMode(style);
  const y = m.y - 18;
  const width = m.head + 5;
  const portrait = face(gender, colors, m, direction);
  const visibleHair = mode !== 'full' && mode !== 'hood';
  const hairMarkup = visibleHair ? hair(gender, colors, m, direction) : '';
  let gear = '';
  if (mode === 'full') {
    gear = `<path d="M${48 - width} ${y + 10}q2-31 ${width}-35t${width} 35l-5 16-8-9-7 10-7-10-8 9z" fill="${colors.base}" stroke="${colors.ink}" stroke-width="3"/><path d="M${48 - width + 4} ${y - 4}q${width - 4}-15 ${width * 2 - 8} 0v7H${48 - width + 4}z" fill="${colors.accent}" opacity=".62"/><path d="M38 ${y + 2}h8m5 0h8M48 ${y + 7}v9" stroke="${colors.glow}" stroke-width="2"/><path d="M40 ${y + 12}v5m5-5v7m6-7v7m5-7v5" stroke="${colors.dark}" stroke-width="1.3"/>`;
  } else if (mode === 'hood') {
    gear = `<path d="M${48 - width} ${y + 17}q-2-32 ${width}-39t${width} 39l-7 15-8-8-7 10-7-10-8 8z" fill="${colors.base}" stroke="${colors.ink}" stroke-width="3"/><path d="M${48 - width + 5} ${y + 9}q0-24 ${width - 5}-29t${width - 5} 29q-${width - 5} 11-${width * 2 - 10} 0z" fill="${colors.dark}" stroke="${colors.accent}" stroke-width="2"/>${portrait}`;
  } else if (mode === 'mask') {
    gear = `<path d="M${48 - m.head + 2} ${y - 5}q${m.head - 2}-7 ${m.head * 2 - 4} 0v16l-6 9-6-5-4 7-4-7-6 5-6-9z" fill="${colors.base}" stroke="${colors.ink}" stroke-width="3"/><path d="M37 ${y + 1}h9m5 0h9M48 ${y + 6}v9" stroke="${colors.glow}" stroke-width="2"/>`;
  } else if (mode === 'ornamental') {
    gear = `<path d="M${48 - width + 3} ${y - 10}l5-10 8 7 7-13 7 13 8-7 5 10z" fill="${colors.accent}" stroke="${colors.ink}" stroke-width="2.5"/><circle cx="48" cy="${y - 17}" r="3" fill="${colors.glow}"/>`;
  } else if (mode === 'hat') {
    gear = `<ellipse cx="48" cy="${y - 9}" rx="${width + 8}" ry="7" fill="${colors.dark}" stroke="${colors.ink}" stroke-width="3"/><path d="M${48 - width + 2} ${y - 12}q3-27 ${width - 2}-34 10 9 ${width - 1} 35z" fill="${colors.base}" stroke="${colors.ink}" stroke-width="3"/><path d="M${48 - width + 7} ${y - 14}q${width - 7}-8 ${width * 2 - 14} 0" fill="none" stroke="${colors.glow}" stroke-width="2"/>`;
  }
  return `<g data-part="head" data-style="${esc(style)}" data-head-occlusion="${mode}" data-visible-hair="${visibleHair ? 1 : 0}" data-horn-count="0">${hairMarkup}${portrait}${gear}</g>`;
};

export const aura = (style, palette, seed) => {
  if (style === 'none') return '';
  const colors = ramp(palette);
  const marks = Array.from({ length: 6 }, (_, i) => {
    const side = i % 2 ? 1 : -1;
    const x = 48 + side * (35 + index(seed, 8, `aura-x-${i}`));
    const y = 19 + index(seed, 96, `aura-y-${i}`);
    return i % 2
      ? `<circle cx="${x}" cy="${y}" r="${1 + i % 3}" fill="${colors.glow}" opacity=".38"/>`
      : `<path d="M${x - 3} ${y}h6M${x} ${y - 3}v6" stroke="${colors.accent}" stroke-width="1.2" opacity=".4"/>`;
  }).join('');
  return `<g data-part="aura" data-body-overlap="0"><ellipse cx="48" cy="128" rx="34" ry="7" fill="none" stroke="${colors.glow}" stroke-width="1.4" opacity=".2"/>${marks}</g>`;
};

export const back = (style, palette, seed) => {
  if (style === 'none') return '';
  const colors = ramp(palette);
  if (has(style, ['quiver', 'arrow', 'bolt'])) {
    const x = index(style, 2) ? 22 : 69;
    return `<g data-part="back" data-style="${esc(style)}"><path d="M${x - 7} 58l14-2 2 56-12 8-9-9z" fill="${colors.base}" stroke="${colors.ink}" stroke-width="3"/><path d="M${x - 4} 63l8-1 1 44-7 6z" fill="${colors.dark}"/>${Array.from({ length: 5 }, (_, i) => `<path d="M${x - 4 + i * 2} 58l${i - 2}-24" stroke="${i % 2 ? colors.glow : colors.accent}" stroke-width="1.5"/>`).join('')}</g>`;
  }
  if (has(style, ['wing', 'feather'])) {
    return `<g data-part="back" data-style="${esc(style)}"><path d="M37 58Q11 48 10 91q10-10 19-5-6 15 4 27 8-17 15-39zM59 58q26-10 27 33-10-10-19-5 6 15-4 27-8-17-15-39z" fill="${colors.base}" stroke="${colors.ink}" stroke-width="3"/><path d="M34 64q-13 10-17 29M62 64q13 10 17 29" fill="none" stroke="${colors.glow}" stroke-width="1.6" opacity=".6"/></g>`;
  }
  if (has(style, ['pack', 'case', 'rack'])) {
    return `<g data-part="back" data-style="${esc(style)}"><path d="M19 58q11-8 21 0l-2 55-11 8-10-9z" fill="${colors.base}" stroke="${colors.ink}" stroke-width="3"/><path d="M22 66h15M20 87h17M27 60v56" stroke="${colors.accent}" stroke-width="1.5"/></g>`;
  }
  if (has(style, ['antler', 'trophy', 'skull'])) {
    return `<g data-part="back" data-style="${esc(style)}" data-horn-count="0"><path d="M37 70q11-12 22 0l-4 20-7 7-7-7z" fill="${colors.dark}" stroke="${colors.ink}" stroke-width="3"/><circle cx="43" cy="76" r="2" fill="${colors.glow}"/><circle cx="53" cy="76" r="2" fill="${colors.glow}"/></g>`;
  }
  return `<g data-part="back" data-style="${esc(style)}"><path d="M27 56q21-10 42 0l3 66-9-6-8 8-7-7-7 8-8-8-8 5z" fill="${colors.base}" stroke="${colors.ink}" stroke-width="3"/><path d="M31 63q17-7 34 0M34 70q3 29 1 45M48 65v53M62 70q-3 29-1 45" fill="none" stroke="${colors.accent}" stroke-width="1.5" opacity=".55"/></g>`;
};
