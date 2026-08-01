export const CURRENT_CONTENT_VERSION = '2026.07.31.2';
export const CONTENT_SCHEMA_VERSION = 2;

export interface ContentMapDefinition { key: string; name: string; fileName: string; zoneType: 'SAFE' | 'OUTLAW' | 'PVP'; spawnX: number; spawnY: number; }
export interface ContentItemDefinition { key: string; name: string; description: string; stackLimit: number; metadata: Record<string, unknown>; }
export interface ContentNpcDefinition { key: string; name: string; mapKey: string; preferredX: number; preferredY: number; outfitKey: string; dialogue: Record<string, unknown>; }
export interface ContentQuestDefinition { key: string; name: string; description: string; minimumLevel: number; steps: Array<Record<string, unknown>>; rewards: Record<string, number>; }
export interface ContentEncounterDefinition { key: string; mapKey: string; mobFamilyKeys: string[]; rewardItemKeys: string[]; }
export interface ContentRecipeDefinition { key: string; ingredientItemKeys: string[]; resultItemKey: string; }
export interface ContentExpeditionDefinition { key: string; encounterKeys: string[]; minimumPartySize: number; maximumPartySize: number; }
export interface ContentMobDefinition {
  key: string; name: string; mapKey: string; level: number; outfitKey: string;
  spawnPoints: Array<{ x: number; y: number }>; respawnMs: number;
  stats: { rank: 'SPAWN' | 'EXECUTIONER' | 'ARCH_EXECUTIONER' | 'REAPER' | 'ANCIENT'; characterClass: 'MAGE' | 'WARRIOR' | 'ARCHER'; renderScale: number; experience: number; maxHp: number; maxEnergy: number; strength: number; agility: number; intelligence: number; armor: number; };
  lootTable: Array<{ itemKey: string; chance: number; minQuantity: number; maxQuantity: number }>;
}

export const CONTENT_MAPS: readonly ContentMapDefinition[] = [
  { key: 'greenfields', name: 'Greenfields', fileName: 'greenfields.json', zoneType: 'SAFE', spawnX: 4, spawnY: 4 },
  { key: 'crystal-cave', name: 'Crystal Cave', fileName: 'crystal-cave.json', zoneType: 'OUTLAW', spawnX: 3, spawnY: 3 },
];

export const CONTENT_ITEMS: readonly ContentItemDefinition[] = [
  { key: 'traveler-sword', name: 'Traveler Sword', description: 'A dependable steel blade for a beginning warrior.', stackLimit: 1, metadata: { category: 'EQUIPMENT', rarity: 'COMMON', icon: '⚔', equipmentSlot: 'MAIN_HAND', requiredClass: 'WARRIOR', minimumLevel: 5, statBonuses: { strength: 3 }, buyPriceSilver: 180, sellPriceSilver: 72 } },
  { key: 'apprentice-staff', name: 'Apprentice Staff', description: 'A simple focus for novice spellcasters.', stackLimit: 1, metadata: { category: 'EQUIPMENT', rarity: 'ARTIFACT', icon: '✦', equipmentSlot: 'MAIN_HAND', requiredClass: 'MAGE', minimumLevel: 5, statBonuses: { intelligence: 3, maxEnergy: 10 }, buyPriceSilver: 180, sellPriceSilver: 72 } },
  { key: 'field-bow', name: 'Field Bow', description: 'A light bow made for quick shots.', stackLimit: 1, metadata: { category: 'EQUIPMENT', rarity: 'MYTHIC', icon: '➶', equipmentSlot: 'MAIN_HAND', requiredClass: 'ARCHER', minimumLevel: 5, statBonuses: { agility: 3 }, buyPriceSilver: 180, sellPriceSilver: 72 } },
  { key: 'minor-health-potion', name: 'Minor Health Potion', description: 'Restores 35 health.', stackLimit: 20, metadata: { category: 'CONSUMABLE', rarity: 'COMMON', icon: '◆', effect: { hp: 35 }, buyPriceSilver: 24, sellPriceSilver: 9 } },
  { key: 'field-rations', name: 'Field Rations', description: 'Restores 30 energy.', stackLimit: 20, metadata: { category: 'CONSUMABLE', rarity: 'COMMON', icon: '●', effect: { energy: 30 }, buyPriceSilver: 18, sellPriceSilver: 7 } },
  { key: 'town-scroll', name: 'Town Scroll', description: 'A dormant scroll prepared for a future travel system.', stackLimit: 10, metadata: { category: 'QUEST', rarity: 'COMMON', icon: '▱', buyPriceSilver: 0, sellPriceSilver: 0, sellable: false } },
  { key: 'rabbit-fur', name: 'Królicze futro', description: 'Miękkie futro spaczonego królika.', stackLimit: 50, metadata: { category: 'MATERIAL', rarity: 'COMMON', icon: '◌', buyPriceSilver: 0, sellPriceSilver: 5, sellable: true } },
  { key: 'rabbit-foot', name: 'Królicza łapka', description: 'Rzadkie trofeum z Królika Pomiotu.', stackLimit: 20, metadata: { category: 'MATERIAL', rarity: 'COMMON', icon: '♧', buyPriceSilver: 0, sellPriceSilver: 22, sellable: true } },
  { key: 'scorpion-chitin', name: 'Chityna skorpiona', description: 'Twarda płyta pancerza Skorpiona Kata.', stackLimit: 50, metadata: { category: 'MATERIAL', rarity: 'COMMON', icon: '⬡', buyPriceSilver: 0, sellPriceSilver: 14, sellable: true } },
  { key: 'scorpion-stinger', name: 'Żądło skorpiona', description: 'Ostre żądło przydatne w rzemiośle.', stackLimit: 20, metadata: { category: 'MATERIAL', rarity: 'COMMON', icon: '⌁', buyPriceSilver: 0, sellPriceSilver: 44, sellable: true } },
  { key: 'venom-sac', name: 'Woreczek jadowy', description: 'Rzadki gruczoł jadowy Skorpiona Kata.', stackLimit: 10, metadata: { category: 'MATERIAL', rarity: 'COMMON', icon: '◆', buyPriceSilver: 0, sellPriceSilver: 90, sellable: true } },
];

const RABBIT_QUEST_KEY = 'rabbit-fur-for-mira';
export const CONTENT_QUESTS: readonly ContentQuestDefinition[] = [{
  key: RABBIT_QUEST_KEY,
  name: 'Ciepło dla Greenfields',
  description: 'Zdobądź pięć króliczych futer dla Miry, aby mogła uszyć ciepłe koce dla dzieci z osady.',
  minimumLevel: 1,
  steps: [{ id: 'collect-rabbit-fur', type: 'COLLECT_ITEM', itemKey: 'rabbit-fur', quantity: 5, consumeOnComplete: true, label: { pl: 'Zdobądź królicze futra', en: 'Collect rabbit furs' } }],
  rewards: { experience: 180, gold: 0, silver: 300 },
}];

const miraDialogue = {
  type: 'QUEST', rootNodeId: 'need-help',
  quest: { questKey: RABBIT_QUEST_KEY, rootNodes: { notStarted: 'need-help', active: 'waiting', ready: 'ready', rewarded: 'after' } },
  nodes: {
    'need-help': { text: { pl: 'Dobrze, że jesteś! Nocami robi się tu przeraźliwie zimno, a ja szyję koce dla dzieci z Greenfields. Potrzebuję pięciu króliczych futer, ale sama nie dam rady przegonić tych spaczonych bestii.', en: 'I am glad you came! The nights are bitterly cold, and I am sewing blankets for the children of Greenfields. I need five rabbit furs, but I cannot face those corrupted beasts alone.' }, choices: [{ id: 'accept', label: { pl: 'Pomogę ci. Zdobędę pięć futer.', en: 'I will help. I will bring five furs.' }, questAction: { type: 'ACCEPT', questKey: RABBIT_QUEST_KEY, successNodeId: 'accepted' } }, { id: 'decline', label: { pl: 'Nie teraz.', en: 'Not now.' }, action: 'CLOSE' }] },
    accepted: { text: { pl: 'Dziękuję! Króliki Pomiotu kręcą się po całych Greenfields. Przynieś mi pięć futer, a porządnie cię wynagrodzę.', en: 'Thank you! Spawn Rabbits roam all over Greenfields. Bring me five furs and I will reward you properly.' }, choices: [{ id: 'leave', label: { pl: 'Wrócę z futrami.', en: 'I will return with the furs.' }, action: 'CLOSE' }] },
    waiting: { text: { pl: 'Koce czekają. Masz już dla mnie pięć króliczych futer?', en: 'The blankets are waiting. Do you have five rabbit furs for me?' }, choices: [{ id: 'turn-in', label: { pl: 'Mam dla ciebie futra.', en: 'I have the furs for you.' }, questAction: { type: 'TURN_IN', questKey: RABBIT_QUEST_KEY, successNodeId: 'thanks', incompleteNodeId: 'missing' } }, { id: 'leave', label: { pl: 'Jeszcze ich szukam.', en: 'I am still looking.' }, action: 'CLOSE' }] },
    ready: { text: { pl: 'Widzę, że masz komplet futer. Czy to wszystko dla mnie?', en: 'I can see you have all the fur. Is it for me?' }, choices: [{ id: 'turn-in', label: { pl: 'Tak, weź pięć futer.', en: 'Yes, take five furs.' }, questAction: { type: 'TURN_IN', questKey: RABBIT_QUEST_KEY, successNodeId: 'thanks', incompleteNodeId: 'missing' } }, { id: 'leave', label: { pl: 'Jeszcze nie.', en: 'Not yet.' }, action: 'CLOSE' }] },
    missing: { text: { pl: 'Nie naliczyłam pięciu futer. Wróć, gdy naprawdę będziesz mieć komplet.', en: 'That is fewer than five rabbit furs. Return when you have the full set.' }, choices: [{ id: 'leave', label: { pl: 'Zdobędę resztę.', en: 'I will find the rest.' }, action: 'CLOSE' }] },
    thanks: { text: { pl: 'Są idealne! Jeszcze dziś uszyję z nich ciepłe podszycia. Dziękuję — uratowałeś dzieciom niejedną zimną noc.', en: 'They are perfect! I will sew warm linings tonight. Thank you — you have spared the children many cold nights.' }, choices: [{ id: 'leave', label: { pl: 'Cieszę się, że pomogłem.', en: 'I am glad I could help.' }, action: 'CLOSE' }] },
    after: { text: { pl: 'Koce są już gotowe, a dzieci pierwszy raz od dawna spały spokojnie. Tego, co zrobiłeś, nie zapomnę.', en: 'The blankets are finished, and the children slept peacefully. I will not forget what you did.' }, choices: [{ id: 'ask', label: { pl: 'Jak radzi sobie osada?', en: 'How is the settlement doing?' }, nextNodeId: 'after-story' }, { id: 'leave', label: { pl: 'Do zobaczenia, Miro.', en: 'Until next time, Mira.' }, action: 'CLOSE' }] },
    'after-story': { text: { pl: 'Lepiej niż wcześniej. Nadal brakuje nam rąk do pracy, ale przynajmniej noc nie odbiera już ludziom sił.', en: 'Better than before. We still lack helping hands, but the cold no longer steals everyone’s strength.' }, choices: [{ id: 'leave', label: { pl: 'Powodzenia.', en: 'Good luck.' }, action: 'CLOSE' }] },
  },
};

export const CONTENT_NPCS: readonly ContentNpcDefinition[] = [
  { key: 'quartermaster', name: 'Borin Żelazna Dłoń', mapKey: 'greenfields', preferredX: 16, preferredY: 6, outfitKey: 'npc-warrior-merchant', dialogue: { type: 'MERCHANT', rootNodeId: 'welcome', nodes: { welcome: { text: { pl: 'Witaj podróżniku, czy chcesz zobaczyć moje towary?', en: 'Welcome, traveler. Would you like to see my wares?' }, choices: [{ id: 'show-offer', label: { pl: 'Pokaż mi co masz w ofercie!', en: 'Show me what you have for sale!' }, action: 'OPEN_MERCHANT' }, { id: 'decline', label: { pl: 'Nie, dziękuję', en: 'No, thank you' }, action: 'CLOSE' }] } }, merchant: { itemKeys: ['traveler-sword', 'apprentice-staff', 'field-bow', 'minor-health-potion', 'field-rations'], infiniteStock: true } } },
  { key: 'mira-tanner', name: 'Mira Igłopalca', mapKey: 'greenfields', preferredX: 8, preferredY: 5, outfitKey: 'npc-quest-mira', dialogue: miraDialogue },
];

export const CONTENT_MOBS: readonly ContentMobDefinition[] = [
  { key: 'spawn-rabbit', name: 'Królik', mapKey: 'greenfields', level: 2, outfitKey: 'mob-spawn-rabbit', spawnPoints: [{ x: 9, y: 8 }, { x: 12, y: 10 }, { x: 18, y: 12 }, { x: 22, y: 8 }, { x: 24, y: 15 }, { x: 14, y: 17 }, { x: 7, y: 15 }], respawnMs: 15_000, stats: { rank: 'SPAWN', characterClass: 'ARCHER', renderScale: 0.5, experience: 28, maxHp: 72, maxEnergy: 0, strength: 9, agility: 12, intelligence: 1, armor: 3 }, lootTable: [{ itemKey: 'rabbit-fur', chance: 0.65, minQuantity: 1, maxQuantity: 2 }, { itemKey: 'rabbit-foot', chance: 0.12, minQuantity: 1, maxQuantity: 1 }, { itemKey: 'minor-health-potion', chance: 0.08, minQuantity: 1, maxQuantity: 1 }] },
  { key: 'executioner-scorpion', name: 'Skorpion', mapKey: 'crystal-cave', level: 7, outfitKey: 'mob-executioner-scorpion', spawnPoints: [{ x: 8, y: 7 }, { x: 13, y: 11 }, { x: 19, y: 9 }, { x: 22, y: 14 }, { x: 16, y: 17 }, { x: 9, y: 16 }, { x: 23, y: 6 }], respawnMs: 30_000, stats: { rank: 'EXECUTIONER', characterClass: 'WARRIOR', renderScale: 0.85, experience: 145, maxHp: 310, maxEnergy: 0, strength: 31, agility: 18, intelligence: 3, armor: 17 }, lootTable: [{ itemKey: 'scorpion-chitin', chance: 0.72, minQuantity: 1, maxQuantity: 3 }, { itemKey: 'scorpion-stinger', chance: 0.24, minQuantity: 1, maxQuantity: 1 }, { itemKey: 'venom-sac', chance: 0.09, minQuantity: 1, maxQuantity: 1 }, { itemKey: 'minor-health-potion', chance: 0.06, minQuantity: 1, maxQuantity: 2 }] },
];

export const CONTENT_ENCOUNTERS: readonly ContentEncounterDefinition[] = [];
export const CONTENT_RECIPES: readonly ContentRecipeDefinition[] = [];
export const CONTENT_EXPEDITIONS: readonly ContentExpeditionDefinition[] = [];
