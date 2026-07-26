export const MOCK_INVENTORY_ITEMS = [
  { name: 'Traveler Sword', icon: '⚔', rarity: 'Common', quantity: 1 },
  { name: 'Minor Health Potion', icon: '◆', rarity: 'Uncommon', quantity: 4 },
  { name: 'Cave Crystal', icon: '✦', rarity: 'Rare', quantity: 2 },
  { name: 'Town Scroll', icon: '▱', rarity: 'Uncommon', quantity: 1 },
  { name: 'Field Rations', icon: '●', rarity: 'Common', quantity: 6 },
] as const;

export const MOCK_QUESTS = [
  {
    title: 'A Light in the Cave',
    category: 'Main Story',
    objective: 'Investigate the Crystal Cave entrance.',
    progress: '0 / 1',
  },
  {
    title: 'Greenfields Welcome',
    category: 'Town',
    objective: 'Speak with the village steward.',
    progress: '1 / 3',
  },
  {
    title: 'Gathering Supplies',
    category: 'Optional',
    objective: 'Collect field herbs near the road.',
    progress: '3 / 8',
  },
] as const;

export const MOCK_SKILLS = [
  { id: 'focus', label: 'Focus', rank: 1, x: 50, y: 10 },
  { id: 'survival', label: 'Survival', rank: 0, x: 25, y: 42 },
  { id: 'precision', label: 'Precision', rank: 0, x: 75, y: 42 },
  { id: 'mastery', label: 'Class Mastery', rank: 0, x: 50, y: 75 },
] as const;

export const MOCK_CHAT_MESSAGES = {
  Global: [
    { author: 'Realm', text: 'Welcome to World 1.', tone: 'system' },
    { author: 'Wayfarer', text: 'Has anyone explored the cave portal?', tone: 'player' },
  ],
  Local: [
    { author: 'Village Guard', text: 'The eastern road is quiet today.', tone: 'npc' },
  ],
  System: [
    { author: 'System', text: 'Movement and visibility are connected to the live server.', tone: 'system' },
    { author: 'System', text: 'Combat, inventory, quests, and skills are visual mocks.', tone: 'warning' },
  ],
} as const;
