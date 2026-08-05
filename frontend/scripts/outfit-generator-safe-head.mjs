import { esc, has, outline } from './outfit-generator-utils.mjs';

const colors = ([dark, base, accent, glow, skin = '#c79572']) => ({
  ink: outline,
  dark,
  base,
  accent,
  glow,
  skin,
});

const modeFor = (style) => {
  if (has(style, ['helm', 'faceless'])) return 'full';
  if (has(style, ['hood'])) return 'hood';
  if (has(style, ['mask', 'veil'])) return 'mask';
  if (has(style, ['hat', 'brim'])) return 'hat';
  if (has(style, ['crown', 'circlet', 'tiara'])) return 'ornamental';
  return 'open';
};

const portrait = (gender, c, m, direction) => {
  const y = m.y - 18;
  const side = direction === 'WEST';
  if (direction === 'NORTH') {
    return `<g data-part="portrait"><ellipse cx="48" cy="${y}" rx="${m.head}" ry="${gender === 'FEMALE' ? 16 : 18}" fill="${c.skin}" stroke="${c.ink}" stroke-width="3"/></g>`;
  }
  const eyeMarkup = side
    ? `<ellipse cx="42" cy="${y + 1}" rx="2.5" ry="2" fill="#ece4d8"/><circle cx="42" cy="${y + 1}" r="1" fill="${c.glow}"/>`
    : `<ellipse cx="42" cy="${y + 1}" rx="2.5" ry="2" fill="#ece4d8"/><ellipse cx="54" cy="${y + 1}" rx="2.5" ry="2" fill="#ece4d8"/><circle cx="42" cy="${y + 1}" r="1" fill="${c.glow}"/><circle cx="54" cy="${y + 1}" r="1" fill="${c.glow}"/>`;
  const jaw = gender === 'FEMALE'
    ? `M${48 - m.head} ${y - 4}q1-12 ${m.head}-14t${m.head} 14q0 14-${m.head} 19q-${m.head}-5-${m.head}-19z`
    : `M${48 - m.head} ${y - 4}q1-13 ${m.head}-15t${m.head} 15q0 16-${m.head} 21q-${m.head}-5-${m.head}-21z`;
  return `<g data-part="portrait"><path d="${jaw}" fill="${c.skin}" stroke="${c.ink}" stroke-width="3"/><ellipse cx="43" cy="${y - 7}" rx="5" ry="3" fill="#fff4dc" opacity=".32"/>${eyeMarkup}<path d="M46 ${y + 10}q3 2 6 0" fill="none" stroke="#805947" stroke-width="1.2"/></g>`;
};

const hair = (gender, c, m, direction) => {
  const y = m.y - 18;
  const width = m.head + (gender === 'FEMALE' ? 5 : 3);
  const length = gender === 'FEMALE' ? 29 : 18;
  const sideLock = direction === 'WEST'
    ? `<path d="M${48 - width + 4} ${y + 2}q-3 12 2 23" fill="none" stroke="${c.glow}" stroke-width="1.4" opacity=".55"/>`
    : '';
  return `<g data-part="hair" data-hair-bounded="true"><path d="M${48 - width} ${y - 4}q2-20 ${width}-23t${width} 23l-2 ${length}q-${Math.round(width * .55)} 8-${width - 2} 4q-${Math.round(width * .5)} 5-${width - 2}-4l-2-${length}z" fill="${c.dark}" stroke="${c.ink}" stroke-width="3"/><path d="M${48 - width + 2} ${y - 5}q3-17 ${width - 2}-20t${width - 2} 20l-5-2-5 10-7-11-7 11-5-10-5 3z" fill="${c.dark}" stroke="${c.ink}" stroke-width="2"/><path d="M${48 - width + 7} ${y - 12}q${width - 7}-10 ${width * 2 - 14} 0M${48 - width + 8} ${y + 1}q-1 12 2 21M${48 + width - 8} ${y + 1}q1 12-2 21" fill="none" stroke="${c.accent}" stroke-width="1.7" opacity=".62"/>${sideLock}</g>`;
};

export const faceAndHead = (style, gender, palette, m, direction) => {
  const c = colors(palette);
  const mode = modeFor(style);
  const y = m.y - 18;
  const width = m.head + 5;
  const face = portrait(gender, c, m, direction);
  const visibleHair = mode !== 'full' && mode !== 'hood';
  const hairMarkup = visibleHair ? hair(gender, c, m, direction) : '';

  if (mode === 'full') {
    return `<g data-part="head" data-style="${esc(style)}" data-head-occlusion="full" data-visible-hair="0" data-horn-count="0"><path d="M${48 - width} ${y + 10}q2-31 ${width}-35t${width} 35l-5 16-8-9-7 10-7-10-8 9z" fill="${c.base}" stroke="${c.ink}" stroke-width="3"/><path d="M${48 - width + 4} ${y - 4}q${width - 4}-15 ${width * 2 - 8} 0v7H${48 - width + 4}z" fill="${c.accent}" opacity=".62"/><path d="M38 ${y + 2}h8m5 0h8M48 ${y + 7}v9" stroke="${c.glow}" stroke-width="2"/><path d="M40 ${y + 12}v5m5-5v7m6-7v7m5-7v5" stroke="${c.dark}" stroke-width="1.3"/></g>`;
  }

  if (mode === 'hood') {
    return `<g data-part="head" data-style="${esc(style)}" data-head-occlusion="hood" data-visible-hair="0" data-horn-count="0"><path d="M${48 - width} ${y + 17}q-2-32 ${width}-39t${width} 39l-7 15-8-8-7 10-7-10-8 8z" fill="${c.base}" stroke="${c.ink}" stroke-width="3"/><path d="M${48 - width + 5} ${y + 9}q0-24 ${width - 5}-29t${width - 5} 29q-${width - 5} 11-${width * 2 - 10} 0z" fill="${c.dark}" stroke="${c.accent}" stroke-width="2"/>${face}<path d="M${48 - width + 6} ${y + 10}q${width - 6} 8 ${width * 2 - 12} 0" fill="none" stroke="${c.glow}" stroke-width="1.4" opacity=".5"/></g>`;
  }

  let gear = '';
  if (mode === 'mask') {
    gear = `<path d="M${48 - m.head + 2} ${y - 5}q${m.head - 2}-7 ${m.head * 2 - 4} 0v16l-6 9-6-5-4 7-4-7-6 5-6-9z" fill="${c.base}" stroke="${c.ink}" stroke-width="3"/><path d="M37 ${y + 1}h9m5 0h9M48 ${y + 6}v9" stroke="${c.glow}" stroke-width="2"/>`;
  } else if (mode === 'ornamental') {
    gear = `<path d="M${48 - width + 4} ${y - 9}q${width - 4}-8 ${width * 2 - 8} 0" fill="none" stroke="${c.accent}" stroke-width="4"/><path d="M${48 - width + 7} ${y - 10}q${width - 7}-5 ${width * 2 - 14} 0" fill="none" stroke="${c.glow}" stroke-width="1.5"/><circle cx="48" cy="${y - 12}" r="3" fill="${c.glow}" stroke="${c.ink}" stroke-width="1"/>`;
  } else if (mode === 'hat') {
    gear = `<ellipse cx="48" cy="${y - 9}" rx="${width + 8}" ry="7" fill="${c.dark}" stroke="${c.ink}" stroke-width="3"/><path d="M${48 - width + 2} ${y - 12}q3-27 ${width - 2}-34 10 9 ${width - 1} 35z" fill="${c.base}" stroke="${c.ink}" stroke-width="3"/><path d="M${48 - width + 7} ${y - 14}q${width - 7}-8 ${width * 2 - 14} 0" fill="none" stroke="${c.glow}" stroke-width="2"/>`;
  }

  return `<g data-part="head" data-style="${esc(style)}" data-head-occlusion="${mode}" data-visible-hair="1" data-horn-count="0">${hairMarkup}${face}${gear}</g>`;
};
