import {
  esc,
  has,
  headgearAllowsHair,
  headgearHornCount,
  headgearMode,
  paletteRamp,
} from './outfit-generator-utils.mjs';

const wrapGenderPart = (gender, part, content, occluded = false) =>
  gender === 'FEMALE'
    ? `<g data-part="female-${part}" data-occluded="${occluded ? 'true' : 'false'}">${content}</g>`
    : content;

const hairBack = (gender, ramp, m, style, pose) => {
  if (!headgearAllowsHair(style)) return wrapGenderPart(gender, 'hair', '', true);
  const y = m.y - 18;
  const long = gender === 'FEMALE' || has(style, ['braid', 'long', 'veil', 'mane']);
  const width = m.head + (gender === 'FEMALE' ? 5 : 3);
  const length = long ? 31 : 18;
  const shift = m.facing * 2 + pose.hair * 0.25;
  const mass = `<path d="M${48 - width + shift} ${y - 4}q2-22 ${width} -24t${width} 24l${2 + pose.cloak * .3} ${length - 4}q-${Math.round(width * .45)} 9-${width - 3} 5q-${Math.round(width * .55)} 6-${width + 3} -5l${-2 + pose.cloak * .3}-${length - 4}z" fill="${ramp.hair}" stroke="${ramp.ink}" stroke-width="3"/>`;
  const highlights = `<path d="M${48 - width + 6 + shift} ${y - 11}q${width - 6}-12 ${width * 2 - 12} 0" fill="none" stroke="${ramp.hairLight}" stroke-width="2" opacity=".62"/><path d="M${48 - width + 7 + shift} ${y + 2}q2 13 1 ${Math.min(y + length - 4, 74)}M${48 + width - 7 + shift} ${y + 2}q-2 13-1 ${Math.min(y + length - 4, 74)}" fill="none" stroke="${ramp.hairMid}" stroke-width="2" opacity=".62"/>`;
  const content = `<g data-part="hair-back" data-style="${esc(style)}">${mass}${highlights}</g>`;
  return wrapGenderPart(gender, 'hair', content);
};

const face = (gender, ramp, m) => {
  const y = m.y - 18;
  const faceHeight = gender === 'FEMALE' ? 16 : 18;
  if (m.north) {
    const rear = `<g data-part="portrait" data-visibility="rear"><ellipse cx="48" cy="${y}" rx="${m.head}" ry="${faceHeight}" fill="${ramp.skinShadow}" stroke="${ramp.ink}" stroke-width="3"/></g>`;
    return wrapGenderPart(gender, 'portrait', rear);
  }
  const faceX = 48 + m.facing * 2;
  const side = m.facing !== 0;
  const eyes = side
    ? `<ellipse cx="${48 + m.facing * 6}" cy="${y}" rx="2.5" ry="2" fill="#e8e1d2"/><circle cx="${48 + m.facing * 6}" cy="${y}" r="1.15" fill="${ramp.glow}"/><circle cx="${48 + m.facing * 6}" cy="${y}" r=".5" fill="${ramp.ink}"/>`
    : `<ellipse cx="42" cy="${y}" rx="2.5" ry="2" fill="#e8e1d2"/><ellipse cx="54" cy="${y}" rx="2.5" ry="2" fill="#e8e1d2"/><circle cx="42" cy="${y}" r="1.15" fill="${ramp.glow}"/><circle cx="54" cy="${y}" r="1.15" fill="${ramp.glow}"/><circle cx="42" cy="${y}" r=".5" fill="${ramp.ink}"/><circle cx="54" cy="${y}" r=".5" fill="${ramp.ink}"/>`;
  const jaw = gender === 'FEMALE'
    ? `q0 ${faceHeight - 3}-${m.head} ${faceHeight + 2}q-${m.head} -5-${m.head}-${faceHeight + 2}z`
    : `q0 ${faceHeight - 1}-${m.head} ${faceHeight + 4}q-${m.head} -5-${m.head}-${faceHeight + 4}z`;
  const mouth = gender === 'FEMALE'
    ? `<path d="M${faceX - 4 + m.facing} ${y + 10}q4 2 8 0" fill="none" stroke="${ramp.skinShadow}" stroke-width="1.2"/>`
    : `<path d="M${faceX - 5 + m.facing} ${y + 10}q5 3 10 0" fill="none" stroke="${ramp.skinShadow}" stroke-width="1.4"/>`;
  const content = `<g data-part="portrait"><path d="M${faceX - m.head} ${y - 3}q1-${faceHeight - 3} ${m.head}-${faceHeight}t${m.head} ${faceHeight}${jaw}" fill="${ramp.skin}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${faceX - m.head + 4} ${y + 6}q${m.head - 4} 9 ${m.head * 2 - 8} 0v6q-${m.head - 4} 6-${m.head * 2 - 8} 0z" fill="${ramp.skinShadow}" opacity=".45"/><ellipse cx="${faceX - 5 + m.facing}" cy="${y - 7}" rx="5" ry="3" fill="${ramp.skinLight}" opacity=".45"/>${eyes}<path d="M${faceX + m.facing} ${y + 2}l${m.facing || 1} 4" stroke="${ramp.skinShadow}" stroke-width="1.2"/>${mouth}</g>`;
  return wrapGenderPart(gender, 'portrait', content);
};

const hairFront = (gender, ramp, m, style) => {
  if (!headgearAllowsHair(style)) return '';
  const y = m.y - 18;
  const width = m.head + (gender === 'FEMALE' ? 4 : 3);
  const shift = m.facing * 2;
  const fringeDepth = gender === 'FEMALE' ? 12 : 9;
  const base = `<path d="M${48 - width + shift} ${y - 5}q3-20 ${width}-22t${width} 22l-5-2-5 ${fringeDepth}-7-${fringeDepth + 2}-7 ${fringeDepth + 2}-5-${fringeDepth}-5 2z" fill="${ramp.hair}" stroke="${ramp.ink}" stroke-width="2"/>`;
  const highlights = `<path d="M${48 - width + 7 + shift} ${y - 15}q${Math.round(width * .55)}-6 ${width - 2} 0M${48 + 2 + shift} ${y - 17}q${Math.round(width * .45)}-3 ${width - 7} 3" fill="none" stroke="${ramp.hairLight}" stroke-width="1.6" opacity=".7"/>`;
  const locks = gender === 'FEMALE'
    ? `<path d="M${48 - width + 2 + shift} ${y - 2}q-2 14 4 25l5-5q-4-10-2-20zM${48 + width - 2 + shift} ${y - 2}q2 14-4 25l-5-5q4-10 2-20z" fill="${ramp.hairMid}" stroke="${ramp.ink}" stroke-width="1.5"/>`
    : '';
  return `<g data-part="hair-front">${base}${highlights}${locks}</g>`;
};

const explicitHorns = (style, ramp, y, width) => {
  if (headgearHornCount(style) === 0) return '';
  return `<g data-part="headgear-horns"><path d="M${48 - width + 5} ${y - 12}q-10-12-12-25 11 7 18 22zM${48 + width - 5} ${y - 12}q10-12 12-25-11 7-18 22z" fill="${ramp.accent}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${48 - width + 3} ${y - 16}q-6-7-7-14M${48 + width - 3} ${y - 16}q6-7 7-14" fill="none" stroke="${ramp.light}" stroke-width="1.4"/></g>`;
};

const headGear = (style, gender, ramp, m, pose) => {
  const y = m.y - 18;
  const width = m.head + 5;
  const mode = headgearMode(style);
  const hairBackMarkup = hairBack(gender, ramp, m, style, pose);
  const faceMarkup = face(gender, ramp, m);
  const hairFrontMarkup = hairFront(gender, ramp, m, style);
  const occludedFemale = gender === 'FEMALE'
    ? `<g data-part="female-hair" data-occluded="true"/><g data-part="female-portrait" data-occluded="true"/>`
    : '';

  if (mode === 'hood') {
    const horns = explicitHorns(style, ramp, y, width);
    return `${occludedFemale}${horns}<path d="M${48 - width} ${y + 18}q-3-34 ${width}-40t${width} 40l-7 16-9-8-7 11-7-11-9 8z" fill="${ramp.shadow}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${48 - width + 4} ${y + 13}q0-27 ${width - 4}-33t${width - 4} 33l-6 10-8-7-7 9-7-9-8 7z" fill="${ramp.base}"/><path d="M${48 - width + 7} ${y - 5}q${width - 7}-20 ${width * 2 - 14} 0" fill="none" stroke="${ramp.light}" stroke-width="2"/>${faceMarkup}<circle cx="48" cy="${y + 19}" r="3" fill="${ramp.glow}" stroke="${ramp.ink}" stroke-width="1.5"/>`;
  }

  if (mode === 'full') {
    const horns = explicitHorns(style, ramp, y, width);
    const crest = has(style, ['crest', 'plume'])
      ? `<path d="M48 ${y - 24}q-7-14 0-25 7 11 0 25z" fill="${ramp.accent}" stroke="${ramp.ink}" stroke-width="2"/>`
      : '';
    return `${occludedFemale}${horns}${crest}<path d="M${48 - width} ${y + 10}q2-32 ${width}-36t${width} 36l-5 16-8-10-7 11-7-11-8 10z" fill="${ramp.mid}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${48 - width + 4} ${y - 3}q${width - 4}-18 ${width * 2 - 8} 0v7H${48 - width + 4}z" fill="${ramp.light}" opacity=".62"/><path d="M${48 - m.head + 3} ${y - 4}h${m.head * 2 - 6}v13l-6 8-5-10-5 10-6-8z" fill="${ramp.dark}" stroke="${ramp.ink}" stroke-width="2"/><path d="M${48 - 10} ${y + 2}h7m6 0h7" stroke="${ramp.glow}" stroke-width="2"/><path d="M39 ${y + 8}v5M44 ${y + 8}v7M49 ${y + 8}v7M54 ${y + 8}v5" stroke="${ramp.mid}" stroke-width="1.3"/>`;
  }

  if (mode === 'mask') {
    const horns = explicitHorns(style, ramp, y, width);
    return `${horns}${hairBackMarkup}${faceMarkup}${hairFrontMarkup}<path d="M${48 - m.head + 2} ${y - 6}q${m.head - 2}-7 ${m.head * 2 - 4} 0v16l-6 9-6-5-4 7-4-7-6 5-6-9z" fill="${ramp.mid}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${48 - 11} ${y}h8m6 0h8" stroke="${ramp.glow}" stroke-width="2.5"/><path d="M48 ${y + 4}v9M41 ${y + 11}l7 5 7-5" fill="none" stroke="${ramp.light}" stroke-width="1.7"/>`;
  }

  if (mode === 'ornamental') {
    const horns = explicitHorns(style, ramp, y, width);
    return `${horns}${hairBackMarkup}${faceMarkup}${hairFrontMarkup}<path d="M${48 - width + 3} ${y - 10}l5-12 8 8 7-14 7 14 8-8 5 12z" fill="${ramp.accent}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${48 - width + 8} ${y - 9}h${width * 2 - 16}" stroke="${ramp.light}" stroke-width="2"/><polygon points="48,${y - 23} 52,${y - 18} 48,${y - 13} 44,${y - 18}" fill="${ramp.glow}" stroke="${ramp.ink}" stroke-width="1.2"/>`;
  }

  if (mode === 'hat') {
    return `${hairBackMarkup}${faceMarkup}${hairFrontMarkup}<ellipse cx="48" cy="${y - 9}" rx="${width + 8}" ry="7" fill="${ramp.dark}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${48 - width + 2} ${y - 12}q4-29 ${width - 2}-36 12 9 ${width - 1} 37z" fill="${ramp.base}" stroke="${ramp.ink}" stroke-width="3"/><path d="M${48 - width + 7} ${y - 14}q${width - 7}-9 ${width * 2 - 14} 0" fill="none" stroke="${ramp.light}" stroke-width="2"/><path d="M36 ${y - 13}h24" stroke="${ramp.accent}" stroke-width="4"/>`;
  }

  return `${hairBackMarkup}${faceMarkup}${hairFrontMarkup}`;
};

export const faceAndHead = (style, gender, palette, m, direction, pose) => {
  const ramp = paletteRamp(palette);
  const mode = headgearMode(style);
  return `<g data-part="head" data-style="${esc(style)}" data-head-occlusion="${mode}" data-visible-hair="${headgearAllowsHair(style) ? 1 : 0}" data-horn-count="${headgearHornCount(style)}">${headGear(style, gender, ramp, m, pose)}</g>`;
};
