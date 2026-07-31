export const CURRENT_CONTENT_VERSION = '2026.07.31.1';
export const CONTENT_SCHEMA_VERSION = 1;

export interface ContentMapDefinition {
  key: string;
  name: string;
  fileName: string;
  zoneType: 'SAFE' | 'OUTLAW' | 'PVP';
  spawnX: number;
  spawnY: number;
}

export interface ContentItemDefinition {
  key: string;
  name: string;
  description: string;
  stackLimit: number;
  metadata: Record<string, unknown>;
}

export interface ContentMobDefinition {
  key: string;
  name: string;
  mapKey: string;
  level: number;
  outfitKey: string;
  spawnPoints: Array<{ x: number; y: number }>;
  respawnMs: number;
  stats: {
    rank: 'SPAWN' | 'EXECUTIONER' | 'ARCH_EXECUTIONER' | 'REAPER' | 'ANCIENT';
    characterClass: 'MAGE' | 'WARRIOR' | 'ARCHER';
    renderScale: number;
    experience: number;
    maxHp: number;
    maxEnergy: number;
    strength: number;
    agility: number;
    intelligence: number;
    armor: number;
  };
  lootTable: Array<{
    itemKey: string;
    chance: number;
    minQuantity: number;
    maxQuantity: number;
  }>;
}

export const CONTENT_MAPS: readonly ContentMapDefinition[] = [
  { key: 'greenfields', name: 'Greenfields', fileName: 'greenfields.json', zoneType: 'SAFE', spawnX: 4, spawnY: 4 },
  { key: 'crystal-cave', name: 'Crystal Cave', fileName: 'crystal-cave.json', zoneType: 'OUTLAW', spawnX: 3, spawnY: 3 },
];

export const CONTENT_ITEMS: readonly ContentItemDefinition[] = [
  {
    key: 'traveler-sword', name: 'Traveler Sword',
    description: 'A dependable steel blade for a beginning warrior.', stackLimit: 1,
    metadata: { category: 'EQUIPMENT', rarity: 'COMMON', icon: '⚔', equipmentSlot: 'MAIN_HAND', requiredClass: 'WARRIOR', minimumLevel: 5, statBonuses: { strength: 3 }, buyPriceSilver: 180, sellPriceSilver: 72 },
  },
  {
    key: 'apprentice-staff', name: 'Apprentice Staff',
    description: 'A simple focus for novice spellcasters.', stackLimit: 1,
    metadata: { category: 'EQUIPMENT', rarity: 'ARTIFACT', icon: '✦', equipmentSlot: 'MAIN_HAND', requiredClass: 'MAGE', minimumLevel: 5, statBonuses: { intelligence: 3, maxEnergy: 10 }, buyPriceSilver: 180, sellPriceSilver: 72 },
  },
  {
    key: 'field-bow', name: 'Field Bow', description: 'A light bow made for quick shots.', stackLimit: 1,
    metadata: { category: 'EQUIPMENT', rarity: 'MYTHIC', icon: '➶', equipmentSlot: 'MAIN_HAND', requiredClass: 'ARCHER', minimumLevel: 5, statBonuses: { agility: 3 }, buyPriceSilver: 180, sellPriceSilver: 72 },
  },
  {
    key: 'minor-health-potion', name: 'Minor Health Potion', description: 'Restores 35 health.', stackLimit: 20,
    metadata: { category: 'CONSUMABLE', rarity: 'COMMON', icon: '◆', effect: { hp: 35 }, buyPriceSilver: 24, sellPriceSilver: 9 },
  },
  {
    key: 'field-rations', name: 'Field Rations', description: 'Restores 30 energy.', stackLimit: 20,
    metadata: { category: 'CONSUMABLE', rarity: 'COMMON', icon: '●', effect: { energy: 30 }, buyPriceSilver: 18, sellPriceSilver: 7 },
  },
  {
    key: 'town-scroll', name: 'Town Scroll', description: 'A dormant scroll prepared for a future travel system.', stackLimit: 10,
    metadata: { category: 'QUEST', rarity: 'COMMON', icon: '▱', buyPriceSilver: 0, sellPriceSilver: 0, sellable: false },
  },
  {
    key: 'rabbit-fur', name: 'Królicze futro', description: 'Miękkie futro spaczonego królika.', stackLimit: 50,
    metadata: { category: 'MATERIAL', rarity: 'COMMON', icon: '◌', buyPriceSilver: 0, sellPriceSilver: 5, sellable: true },
  },
  {
    key: 'rabbit-foot', name: 'Królicza łapka', description: 'Rzadkie trofeum z Królika Pomiotu.', stackLimit: 20,
    metadata: { category: 'MATERIAL', rarity: 'COMMON', icon: '♧', buyPriceSilver: 0, sellPriceSilver: 22, sellable: true },
  },
  {
    key: 'scorpion-chitin', name: 'Chityna skorpiona', description: 'Twarda płyta pancerza Skorpiona Kata.', stackLimit: 50,
    metadata: { category: 'MATERIAL', rarity: 'COMMON', icon: '⬡', buyPriceSilver: 0, sellPriceSilver: 14, sellable: true },
  },
  {
    key: 'scorpion-stinger', name: 'Żądło skorpiona', description: 'Ostre żądło przydatne w rzemiośle.', stackLimit: 20,
    metadata: { category: 'MATERIAL', rarity: 'COMMON', icon: '⌁', buyPriceSilver: 0, sellPriceSilver: 44, sellable: true },
  },
  {
    key: 'venom-sac', name: 'Woreczek jadowy', description: 'Rzadki gruczoł jadowy Skorpiona Kata.', stackLimit: 10,
    metadata: { category: 'MATERIAL', rarity: 'COMMON', icon: '◆', buyPriceSilver: 0, sellPriceSilver: 90, sellable: true },
  },
];

export const CONTENT_MOBS: readonly ContentMobDefinition[] = [
  {
    key: 'spawn-rabbit', name: 'Królik', mapKey: 'greenfields', level: 2,
    outfitKey: 'mob-spawn-rabbit',
    spawnPoints: [{ x: 9, y: 8 }, { x: 12, y: 10 }, { x: 18, y: 12 }, { x: 22, y: 8 }, { x: 24, y: 15 }, { x: 14, y: 17 }, { x: 7, y: 15 }],
    respawnMs: 15_000,
    stats: { rank: 'SPAWN', characterClass: 'ARCHER', renderScale: 0.5, experience: 28, maxHp: 72, maxEnergy: 0, strength: 9, agility: 12, intelligence: 1, armor: 3 },
    lootTable: [
      { itemKey: 'rabbit-fur', chance: 0.65, minQuantity: 1, maxQuantity: 2 },
      { itemKey: 'rabbit-foot', chance: 0.12, minQuantity: 1, maxQuantity: 1 },
      { itemKey: 'minor-health-potion', chance: 0.08, minQuantity: 1, maxQuantity: 1 },
    ],
  },
  {
    key: 'executioner-scorpion', name: 'Skorpion', mapKey: 'crystal-cave', level: 7,
    outfitKey: 'mob-executioner-scorpion',
    spawnPoints: [{ x: 8, y: 7 }, { x: 13, y: 11 }, { x: 19, y: 9 }, { x: 22, y: 14 }, { x: 16, y: 17 }, { x: 9, y: 16 }, { x: 23, y: 6 }],
    respawnMs: 30_000,
    stats: { rank: 'EXECUTIONER', characterClass: 'WARRIOR', renderScale: 0.85, experience: 145, maxHp: 310, maxEnergy: 0, strength: 31, agility: 18, intelligence: 3, armor: 17 },
    lootTable: [
      { itemKey: 'scorpion-chitin', chance: 0.72, minQuantity: 1, maxQuantity: 3 },
      { itemKey: 'scorpion-stinger', chance: 0.24, minQuantity: 1, maxQuantity: 1 },
      { itemKey: 'venom-sac', chance: 0.09, minQuantity: 1, maxQuantity: 1 },
      { itemKey: 'minor-health-potion', chance: 0.06, minQuantity: 1, maxQuantity: 2 },
    ],
  },
];

export const BORIN_MERCHANT = {
  key: 'quartermaster', name: 'Borin Żelazna Dłoń', mapKey: 'greenfields', x: 16, y: 6,
  outfitKey: 'npc-warrior-merchant',
  dialogue: {
    type: 'MERCHANT', rootNodeId: 'welcome',
    nodes: {
      welcome: {
        text: { pl: 'Witaj podróżniku, czy chcesz zobaczyć moje towary?', en: 'Welcome, traveler. Would you like to see my wares?' },
        choices: [
          { id: 'show-offer', label: { pl: 'Pokaż mi co masz w ofercie!', en: 'Show me what you have for sale!' }, action: 'OPEN_MERCHANT' },
          { id: 'decline', label: { pl: 'Nie, dziękuję', en: 'No, thank you' }, action: 'CLOSE' },
        ],
      },
    },
    merchant: { itemKeys: ['traveler-sword', 'apprentice-staff', 'field-bow', 'minor-health-potion', 'field-rations'], infiniteStock: true },
  },
} as const;
