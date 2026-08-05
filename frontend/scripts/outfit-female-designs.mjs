const female = (title, palette, variant) => ({ title, palette, variant });

export const FEMALE_OUTFIT_DESIGNS = Object.freeze({
  'mage-apprentice': female('Candle-Witch Initiate', ['#17131c', '#3e2949', '#8b4f77', '#e0a7cc', '#d6a27f'], {
    profile: 'tall', garment: 'dress-candlewitch-layered', head: 'hair-braided-candlepins', shoulders: 'shawl-rounded-wax', weapon: 'scepter-candle', offhand: 'lantern-moth', back: 'veil-waxseals', aura: 'moths-amber', detail: 'wax-script',
  }),
  'mage-scholar': female('Mistress of the Black Archive', ['#111821', '#283f55', '#7b596f', '#d8b4d0', '#d7a885'], {
    profile: 'tall', garment: 'gown-archive-panelled', head: 'hat-archivist-wide', shoulders: 'collar-bookclasps', weapon: 'rod-index', offhand: 'keys-archive', back: 'scrollcase-round', aura: 'letters-soft', detail: 'catalogue-gold',
  }),
  'mage-evoker': female('Ash-Dancer of Cinders', ['#1b1117', '#542331', '#b14448', '#ff9a62', '#d8a17e'], {
    profile: 'slender', garment: 'dress-cinder-dancer', head: 'hair-highbun-emberpins', shoulders: 'sleeves-ember-rounded', weapon: 'chakram-flame', offhand: 'fan-ash', back: 'sash-cinderloop', aura: 'embers-ring', detail: 'cinder-lace',
  }),
  'mage-archmage': female('Moon Court Matriarch', ['#101424', '#292b63', '#7256a7', '#d7b8ff', '#d6a480'], {
    profile: 'broad', garment: 'gown-mooncourt-tiered', head: 'tiara-moonveil', shoulders: 'mantle-crescent-soft', weapon: 'scepter-lunarglass', offhand: 'mirror-moon', back: 'cape-orbit', aura: 'moon-motes', detail: 'lunar-filigree',
  }),
  'mage-illusionist': female('Velvet Mirror Sorceress', ['#111a1d', '#24434b', '#5e7181', '#b0e6df', '#d8aa87'], {
    profile: 'tall', garment: 'coat-velvet-asymmetric', head: 'hair-bob-mirrorclips', shoulders: 'collar-veil-rounded', weapon: 'ribbon-blades', offhand: 'mask-handheld', back: 'mirrors-fan', aura: 'glass-petals', detail: 'velvet-eyes',
  }),
  'mage-elementalist': female('Storm-Weaver Priestess', ['#11191f', '#214b5a', '#79613b', '#efbd6b', '#d4a17e'], {
    profile: 'slender', garment: 'gown-stormweaver-belted', head: 'hair-long-stormbraids', shoulders: 'mantle-cloud-rounded', weapon: 'staff-stormring', offhand: 'vial-lightning', back: 'ribbons-weather', aura: 'rain-sparks', detail: 'storm-knot',
  }),
  'mage-runekeeper': female('Vault-Singer Runemistress', ['#0f171b', '#244550', '#4f7e7b', '#a8e6d8', '#cea07d'], {
    profile: 'tall', garment: 'coat-runesinger-fitted', head: 'circlet-runechain', shoulders: 'collar-stonebeads', weapon: 'harp-rune', offhand: 'chisel-light', back: 'tablet-round', aura: 'glyph-dust', detail: 'song-glyphs',
  }),
  'mage-starcaller': female('Astral Abbess', ['#0d1020', '#202956', '#6552a0', '#cfd3ff', '#d5a481'], {
    profile: 'broad', garment: 'habit-astral-layered', head: 'veil-starabbess', shoulders: 'mantle-orbit-soft', weapon: 'crozier-star', offhand: 'astrolabe-small', back: 'halo-constellation', aura: 'stars-slow', detail: 'abbess-constellation',
  }),
  'mage-chronomancer': female('Keeper of the Thirteenth Hour', ['#15151c', '#3c3548', '#82684f', '#dfbf7e', '#d4a17d'], {
    profile: 'tall', garment: 'dress-hourkeeper-pleated', head: 'hair-coiled-clockpins', shoulders: 'collar-pendulum-round', weapon: 'umbrella-clockwork', offhand: 'watch-chain', back: 'clockcase-oval', aura: 'time-dust', detail: 'thirteen-dials',
  }),
  'mage-voidseer': female('Widow of the Quiet Gate', ['#0c0c14', '#271a35', '#6a3e72', '#c584c9', '#c99a7a'], {
    profile: 'tall', garment: 'mourning-gown-void', head: 'veil-widow-closed', shoulders: 'shawl-shadow-rounded', weapon: 'needle-void', offhand: 'locket-black', back: 'mourning-train', aura: 'quiet-orbs', detail: 'widow-eyes',
  }),
  'mage-ascendant': female('Empress of the Eclipsed Choir', ['#111218', '#4b3821', '#a87c2d', '#ffe29a', '#d8a680'], {
    profile: 'broad', garment: 'regalia-choir-empress', head: 'halo-choir-disc', shoulders: 'mantle-sunpetal', weapon: 'staff-choir', offhand: 'bell-eclipse', back: 'wings-ribbonlight', aura: 'choir-rings', detail: 'solar-hymn',
  }),

  'warrior-recruit': female('Borderland Spearwoman', ['#16191d', '#394047', '#7b5a4d', '#c79b75', '#d4a17e'], {
    profile: 'lean', garment: 'coat-border-split', head: 'hair-ponytail-headband', shoulders: 'pads-round-hide', weapon: 'spear-border', offhand: 'buckler-oval', back: 'pack-fieldkit', aura: 'field-dust', detail: 'border-stitch',
  }),
  'warrior-guard': female('Lantern Gate Sentinel', ['#111924', '#263f5c', '#617f9f', '#c7def2', '#d5a27f'], {
    profile: 'tall', garment: 'armor-sentinel-skirted', head: 'helm-sentinel-round', shoulders: 'pauldrons-dome-small', weapon: 'glaive-lantern', offhand: 'shield-lantern-oval', back: 'cloak-watch', aura: 'lamp-motes', detail: 'lantern-gate',
  }),
  'warrior-vanguard': female('Ironstep Lancer', ['#171719', '#42434a', '#79534d', '#d5a18b', '#d4a17e'], {
    profile: 'tall', garment: 'armor-lancer-segmented', head: 'helm-lancer-plume', shoulders: 'pauldrons-round-lamellar', weapon: 'lance-hooked', offhand: 'parrying-dagger', back: 'pennant-lancer', aura: 'iron-dust', detail: 'lancer-rings',
  }),
  'warrior-champion': female('Rose Arena Duelist', ['#1b1118', '#552433', '#a94d5f', '#f0b1b9', '#d5a17e'], {
    profile: 'slender', garment: 'plate-duelist-cuirass', head: 'hair-braid-rosecrest', shoulders: 'pauldrons-petal-round', weapon: 'rapier-rose', offhand: 'main-gauche', back: 'cape-duelist-short', aura: 'rose-petals', detail: 'arena-rose',
  }),
  'warrior-berserker': female('Frosthide Shieldmaiden', ['#11161b', '#33434b', '#6f7d78', '#d7ece6', '#d4a07d'], {
    profile: 'broad', garment: 'armor-frosthide-layered', head: 'hair-braids-frostbeads', shoulders: 'fur-caps-rounded', weapon: 'axe-bearded-single', offhand: 'shield-hide-oval', back: 'cloak-frostwolf', aura: 'snow-breath', detail: 'frost-braid',
  }),
  'warrior-templar': female('Sister of the Pale Bastion', ['#171719', '#d8d1bc', '#967d54', '#fff1bd', '#d5a17f'], {
    profile: 'tall', garment: 'plate-sister-bastion', head: 'coif-bastion-veil', shoulders: 'pauldrons-bastion-round', weapon: 'sword-bastion', offhand: 'reliquary-shield', back: 'mantle-prayer-white', aura: 'incense-gold', detail: 'bastion-lily',
  }),
  'warrior-warlord': female('Crimson Banner Marshal', ['#130f13', '#3f2029', '#8b3239', '#e9867f', '#d19b79'], {
    profile: 'tall', garment: 'armor-marshal-coat', head: 'hat-marshal-wide', shoulders: 'pauldrons-marshal-rounded', weapon: 'sabre-command', offhand: 'baton-banner', back: 'standard-crimson-folded', aura: 'red-dust', detail: 'marshal-knots',
  }),
  'warrior-dreadnought': female('Forge-Matron Juggernaut', ['#111316', '#34383d', '#88553a', '#eda26c', '#d09b77'], {
    profile: 'massive', garment: 'plate-forgematron-skirted', head: 'helm-forgematron-dome', shoulders: 'pauldrons-boiler-round', weapon: 'maul-forge', offhand: 'gauntlet-anvil', back: 'furnace-pack', aura: 'forge-cinders', detail: 'anvil-rivets',
  }),
  'warrior-kingsguard': female('Queen’s Blackblade', ['#101116', '#242630', '#8f702d', '#efd98a', '#d5a27e'], {
    profile: 'slender', garment: 'coat-blackblade-armored', head: 'hair-knot-goldcomb', shoulders: 'pauldrons-blackblade-round', weapon: 'blade-curved-royal', offhand: 'cloak-clasp-dagger', back: 'cape-black-ermine', aura: 'golden-thread', detail: 'queen-knot',
  }),
  'warrior-titan': female('Mountain Oath Colossus', ['#111416', '#3d4447', '#6f7068', '#c4d0c5', '#cf9b78'], {
    profile: 'massive', garment: 'armor-mountain-oath', head: 'helm-mountain-dome', shoulders: 'boulder-pads-rounded', weapon: 'hammer-oathstone', offhand: 'chain-stone', back: 'slab-oath', aura: 'stone-dust', detail: 'mountain-rings',
  }),
  'warrior-immortal': female('Deathless Ivory Valkyrie', ['#111217', '#ddd2b6', '#9f7b35', '#fff0b0', '#d5a17e'], {
    profile: 'tall', garment: 'plate-valkyrie-ivory', head: 'helm-valkyrie-closedround', shoulders: 'pauldrons-ivory-feathered', weapon: 'glaive-deathless', offhand: 'aegis-ivory', back: 'cloak-soulfeathers', aura: 'souls-soft', detail: 'ivory-sunwheel',
  }),

  'archer-scout': female('Fenland Sling-Huntress', ['#101817', '#29443a', '#6e7051', '#b7c88a', '#d4a17e'], {
    profile: 'slender', garment: 'dress-fenland-shortcoat', head: 'hair-doublebraid-cap', shoulders: 'shawl-reed-rounded', weapon: 'sling-fen', offhand: 'stones-pouch', back: 'basket-reeds', aura: 'gnats-soft', detail: 'reed-stitch',
  }),
  'archer-hunter': female('White Hart Trapper', ['#171713', '#4a4432', '#796c52', '#d1c49a', '#d4a17c'], {
    profile: 'tall', garment: 'coat-trapper-layered', head: 'hood-trapper-round', shoulders: 'fur-collar-soft', weapon: 'crossbow-trapper', offhand: 'snare-coil', back: 'pack-traps', aura: 'pine-dust', detail: 'hart-track',
  }),
  'archer-pathfinder': female('Saltroad Cartographer', ['#11181d', '#314653', '#7e6a54', '#d2bf9e', '#d5a27f'], {
    profile: 'tall', garment: 'coat-cartographer-pleated', head: 'hat-cartographer-wide', shoulders: 'collar-mapcase', weapon: 'bow-folding', offhand: 'compass-brass', back: 'mapcase-round', aura: 'paper-specks', detail: 'saltroad-lines',
  }),
  'archer-ranger': female('Green Chapel Keeper', ['#0f1713', '#25482e', '#557b4e', '#add39a', '#d3a07d'], {
    profile: 'broad', garment: 'habit-greenchapel', head: 'veil-leafkeeper', shoulders: 'mantle-moss-rounded', weapon: 'staff-bow-chapel', offhand: 'seed-lantern', back: 'cloak-moss', aura: 'fireflies-green', detail: 'chapel-vines',
  }),
  'archer-sharpshooter': female('Clocktower Bolt-Mistress', ['#12161b', '#323b47', '#765e4c', '#d7b17d', '#d5a17e'], {
    profile: 'tall', garment: 'coat-boltmistress-tailored', head: 'goggles-boltmistress-cap', shoulders: 'pads-round-brass', weapon: 'crossbow-repeater', offhand: 'rangefinder', back: 'magazine-bolts', aura: 'brass-sparks', detail: 'clocktower-sight',
  }),
  'archer-beaststalker': female('Marshscale Spear-Hunter', ['#111816', '#2f4b3f', '#6d7352', '#bec893', '#d3a07c'], {
    profile: 'tall', garment: 'armor-marshscale-skirted', head: 'hair-cropped-scaleclips', shoulders: 'scale-caps-rounded', weapon: 'spear-harpoon', offhand: 'net-weighted', back: 'trophy-scales-flat', aura: 'marsh-mist', detail: 'scale-rings',
  }),
  'archer-windrunner': female('Sky-Ribbon Courier', ['#101720', '#2b4b5e', '#6c8d91', '#c8e4dc', '#d4a17d'], {
    profile: 'slender', garment: 'coat-courier-ribboned', head: 'hair-ponytail-skybow', shoulders: 'sleeves-wingsoft', weapon: 'bow-light-courier', offhand: 'message-tube', back: 'ribbons-sky', aura: 'wind-rings', detail: 'courier-knot',
  }),
  'archer-nightstalker': female('Moonless Rooftop Assassin', ['#0d0f15', '#202330', '#4b5264', '#a2a9bf', '#cc9878'], {
    profile: 'slender', garment: 'coat-rooftop-split', head: 'hood-rooftop-close', shoulders: 'pads-round-shadow', weapon: 'handcrossbow-twin', offhand: 'wire-garrote', back: 'cloak-rooftop-short', aura: 'moonless-smoke', detail: 'roofline-marks',
  }),
  'archer-warden': female('Thorn-Court Beastmistress', ['#101711', '#2f4e2d', '#6f7e45', '#c5d991', '#d3a07c'], {
    profile: 'tall', garment: 'coat-thorncourt-layered', head: 'hair-braided-thorncomb', shoulders: 'mantle-thorn-rounded', weapon: 'whip-vine', offhand: 'horn-call', back: 'cage-seedpods', aura: 'thorn-petals', detail: 'court-briar',
  }),
  'archer-legend': female('Gilded Falconer', ['#111318', '#34323a', '#9a7134', '#f1cc79', '#d5a17d'], {
    profile: 'tall', garment: 'coat-falconer-gilded', head: 'hat-falconer-wide', shoulders: 'pauldrons-falcon-round', weapon: 'bow-falcon', offhand: 'glove-falcon', back: 'perch-folded', aura: 'gold-feathers', detail: 'falcon-eye',
  }),
  'archer-starshot': female('Nebula Harp-Bow Oracle', ['#0d1020', '#252b5b', '#6957a4', '#d7d4ff', '#d3a07d'], {
    profile: 'broad', garment: 'gown-oracle-nebula', head: 'veil-oracle-stars', shoulders: 'mantle-nebula-round', weapon: 'harp-bow-nebula', offhand: 'comet-charm', back: 'halo-oracle', aura: 'nebula-motes', detail: 'oracle-starweb',
  }),
});

export const resolveOutfitDesign = (design, gender) => {
  if (gender !== 'FEMALE') {
    return { ...design, genderDesignIdentity: `male:${design.key}`, activeVariant: design.variants.MALE };
  }
  const independent = FEMALE_OUTFIT_DESIGNS[design.key];
  if (!independent) throw new Error(`Missing independent female design for ${design.key}.`);
  return {
    ...design,
    title: independent.title,
    palette: independent.palette,
    genderDesignIdentity: `female-independent:${design.key}`,
    activeVariant: independent.variant,
    variants: { ...design.variants, FEMALE: independent.variant },
  };
};
