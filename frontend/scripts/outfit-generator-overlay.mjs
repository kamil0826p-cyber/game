import { esc, has, index, outline } from './outfit-generator-utils.mjs';

const marks = (count, make) => Array.from({ length: count }, (_, i) => make(i)).join('');
const material = (s) => has(s, ['plate', 'armor', 'mail', 'scale']) ? 'metal' : has(s, ['fur', 'pelt', 'hide']) ? 'fur' : has(s, ['leather', 'jerkin', 'vest']) ? 'leather' : 'cloth';
const colors = ([dark, base, accent, glow, skin = '#c79572']) => ({ dark, base, accent, glow, skin, ink: outline });

const torso = (v, c, m, seed) => {
  const kind = material(v.garment);
  const texture = marks(24, (i) => {
    const x = 31 + index(seed, 35, `tx${i}`);
    const y = m.y + 17 + index(seed, 44, `ty${i}`);
    if (kind === 'metal') return i % 3 ? `<path d="M${x - 3} ${y + 2}l6-4" stroke="${i % 2 ? c.glow : c.accent}" stroke-width="1.1" opacity=".68"/>` : `<circle cx="${x}" cy="${y}" r="1.6" fill="${c.glow}" stroke="${c.ink}" stroke-width=".7"/>`;
    if (kind === 'fur') return `<path d="M${x - 3} ${y - 2}l3 5 3-6" fill="none" stroke="${i % 2 ? c.glow : c.accent}" stroke-width="1.3" opacity=".72"/>`;
    if (kind === 'leather') return `<path d="M${x - 2} ${y - 2}l4 4m0-4-4 4" stroke="${i % 2 ? c.accent : c.dark}" stroke-width="1" opacity=".72"/>`;
    return `<path d="M${x - 3} ${y}q3 ${i % 2 ? -3 : 3} 6 0" fill="none" stroke="${i % 3 ? c.accent : c.glow}" stroke-width="1.1" opacity=".62"/>`;
  });
  const panels = kind === 'metal' ? `<path d="M34 ${m.y + 13}l14 8 14-8 6 14-6 17H34l-6-17zM48 ${m.y + 21}v40M35 ${m.y + 40}h26" fill="none" stroke="${c.glow}" stroke-width="1.7" opacity=".72"/>` : `<path d="M34 ${m.y + 16}q14 8 28 0M32 ${m.y + 32}q16 10 32 0M31 ${m.y + 49}q17 9 34 0" fill="none" stroke="${c.glow}" stroke-width="1.4" opacity=".6"/>`;
  return `<g data-part="advanced-torso" data-material="${kind}">${panels}${texture}<path d="M28 97q20 6 40 0" fill="none" stroke="${c.ink}" stroke-width="7"/><path d="M29 96q19 5 38 0" fill="none" stroke="${c.accent}" stroke-width="3"/><rect x="42" y="91" width="12" height="12" rx="2" fill="${c.base}" stroke="${c.ink}" stroke-width="2"/><rect x="46" y="94" width="4" height="5" fill="${c.glow}"/><rect x="28" y="100" width="11" height="14" rx="2" fill="${c.dark}" stroke="${c.ink}" stroke-width="2"/><path d="M30 105h7M59 100q7 9 0 18" fill="none" stroke="${c.glow}" stroke-width="1.5"/></g>`;
};

const arms = (v, c, m, direction) => {
  const side = direction === 'WEST';
  const set = side ? [[70, 1, 1], [34, -1, .5]] : [[25, -1, 1], [71, 1, 1]];
  return `<g data-part="advanced-arms">${set.map(([x, f, o]) => `<g opacity="${o}"><path d="M${x} ${m.y + 23}q${f * 9} 15 ${f * 5} 37" fill="none" stroke="${c.ink}" stroke-width="12" stroke-linecap="round"/><path d="M${x} ${m.y + 23}q${f * 9} 15 ${f * 5} 37" fill="none" stroke="${material(v.garment) === 'metal' ? c.accent : c.base}" stroke-width="8" stroke-linecap="round"/><path d="M${x + f} ${m.y + 25}q${f * 6} 13 ${f * 4} 26" fill="none" stroke="${c.glow}" stroke-width="1.5"/><path d="M${x + f} ${m.y + 43}l${f * 8} 1" stroke="${c.accent}" stroke-width="3"/><circle cx="${x + f * 5}" cy="${m.y + 63}" r="5" fill="${c.skin}" stroke="${c.ink}" stroke-width="2"/><path d="M${x + f * 2} ${m.y + 61}l${f * 6} 2" stroke="#ffe1c4" stroke-width="1.2"/></g>`).join('')}</g>`;
};

const head = (v, gender, c, m, direction, seed) => {
  const y = m.y - 18;
  const hidden = direction === 'NORTH' || has(v.head, ['helm', 'mask', 'faceless']);
  const hair = marks(gender === 'FEMALE' ? 11 : 8, (i) => {
    const n = gender === 'FEMALE' ? 10 : 7;
    const x = 48 - m.head + 4 + i * (m.head * 2 - 8) / n;
    const fall = 8 + index(seed, gender === 'FEMALE' ? 29 : 16, `h${i}`);
    return `<path d="M${x} ${y - 17 + i % 3}q${i % 2 ? 5 : -4} 10 ${x + (i % 2 ? 2 : -2)} ${y + fall}" fill="none" stroke="${i % 3 ? c.accent : c.glow}" stroke-width="${i % 2 ? 1.5 : 2.1}" opacity=".78"/>`;
  });
  const face = hidden ? '' : `<path d="M39 ${y - 4}q3-3 7 0m4 0q3-3 7 0" fill="none" stroke="#805947" stroke-width="1.2"/><ellipse cx="42" cy="${y + 1}" rx="2.8" ry="2.2" fill="#eee6d9"/><ellipse cx="54" cy="${y + 1}" rx="2.8" ry="2.2" fill="#eee6d9"/><circle cx="42" cy="${y + 1}" r="1.3" fill="${c.glow}"/><circle cx="54" cy="${y + 1}" r="1.3" fill="${c.glow}"/><circle cx="42" cy="${y + 1}" r=".55" fill="${c.ink}"/><circle cx="54" cy="${y + 1}" r=".55" fill="${c.ink}"/><path d="M48 ${y + 3}l1 5m-6 3q5 3 10 0" fill="none" stroke="#805947" stroke-width="1.2"/><ellipse cx="43" cy="${y - 7}" rx="5" ry="3" fill="#fff0d7" opacity=".35"/>`;
  const gear = has(v.head, ['helm', 'mask', 'faceless']) ? `<path d="M37 ${y - 5}h22v16l-5 9-6-6-6 6-5-9z" fill="none" stroke="${c.glow}" stroke-width="1.6"/><path d="M39 ${y + 2}h7m4 0h7M48 ${y + 6}v8" stroke="${c.accent}" stroke-width="1.6"/>${marks(5, i => `<path d="M${38 + i * 5} ${y + 10}v6" stroke="${c.base}" stroke-width="1"/>`)}` : hair;
  return `<g data-part="advanced-head" data-style="${esc(v.head)}">${gear}${face}</g>`;
};

const back = (v, c, seed) => `<g data-part="advanced-back">${has(v.back, ['quiver', 'bolt']) ? marks(8, i => `<path d="M${17 + i * 2} 59l${i - 4}-29" stroke="${i % 2 ? c.glow : c.accent}" stroke-width="1.5"/><path d="M${14 + i * 2} ${30 - i}l4 3-5 2" fill="${c.glow}"/>`) : has(v.back, ['cape', 'cloak', 'mantle', 'veil', 'banner']) ? `<path d="M33 58q4 32 2 61M48 55v68M63 58q-4 32-2 61M28 68q20-10 40 0M26 82q22-9 44 0" fill="none" stroke="${c.glow}" stroke-width="1.4" opacity=".62"/>${marks(8, i => `<path d="M${28 + i * 5} ${95 + i % 3 * 7}l3 6" stroke="${i % 2 ? c.accent : c.base}" stroke-width="1.2"/>`)}` : marks(12, i => { const x = 12 + index(seed, 72, `bx${i}`); const y = 40 + index(seed, 78, `by${i}`); return `<path d="M${x - 3} ${y + 2}l6-4" stroke="${i % 2 ? c.glow : c.accent}" stroke-width="1.2" opacity=".62"/>`; })}</g>`;

const weapon = (v, cls, c) => {
  const x = index(v.weapon, 2) ? 75 : 21, f = x > 48 ? 1 : -1;
  if (cls === 'ARCHER' || has(v.weapon, ['bow', 'crossbow'])) return `<g data-part="advanced-weapon"><path d="M${x} 29q${f * 23} 43 0 88M${x} 31v86M${x} 72h${f * 34}" fill="none" stroke="${c.glow}" stroke-width="1.4"/><path d="M${x + f * 32} 68l${f * 10} 4-10 5z" fill="${c.glow}"/>${marks(6, i => `<path d="M${x + f * (i % 2 ? 3 : -3)} ${49 + i * 9}l${f * 7} ${i % 2 ? -3 : 3}" stroke="${c.accent}" stroke-width="1"/>`)}</g>`;
  return `<g data-part="advanced-weapon"><path d="M${x} 23v67M${x - f * 5} 31l${f * 5}-10 ${f * 5} 10M${x - 11} 89q11-6 22 0" fill="none" stroke="${c.glow}" stroke-width="1.6"/>${marks(7, i => `<path d="M${x - 4} ${62 + i * 8}h8" stroke="${i % 2 ? c.accent : c.base}" stroke-width="1.4"/>`)}<circle cx="${x}" cy="122" r="3" fill="${c.glow}" stroke="${c.ink}" stroke-width="1"/></g>`;
};

const aura = (c, seed) => `<g data-part="advanced-aura">${marks(18, i => { const x = 7 + index(seed, 82, `ax${i}`), y = 10 + index(seed, 116, `ay${i}`); return i % 3 === 0 ? `<path d="M${x - 3} ${y}h6M${x} ${y - 3}v6" stroke="${c.glow}" stroke-width="1.1" opacity=".42"/>` : i % 3 === 1 ? `<polygon points="${x},${y - 4} ${x + 3},${y} ${x},${y + 4} ${x - 3},${y}" fill="none" stroke="${c.accent}" stroke-width="1" opacity=".4"/>` : `<circle cx="${x}" cy="${y}" r="${1 + i % 2}" fill="${c.glow}" opacity=".38"/>`; })}<ellipse cx="48" cy="128" rx="34" ry="7" fill="none" stroke="${c.glow}" stroke-width="1.5" opacity=".2"/></g>`;

export const advancedDetailLayer = ({ design, gender, variant, shape, direction, seed }) => {
  const c = colors(design.palette);
  return `<g data-part="advanced-detail-layer" data-style="${esc(variant.detail)}">${back(variant, c, seed)}${torso(variant, c, shape, seed)}${arms(variant, c, shape, direction)}${head(variant, gender, c, shape, direction, seed)}${weapon(variant, design.characterClass, c)}${aura(c, seed)}</g>`;
};
