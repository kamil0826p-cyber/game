import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ContentDialogueDefinition,
  ContentItemDefinition,
  ContentMobDefinition,
  ContentNpcDefinition,
  ContentQuestDefinition,
  GameContentManifest,
} from '../src/foundation/content/content.types.js';
import {
  compileCollisionGrid,
  extractEmbeddedPortals,
  parseTiledMap,
} from '../src/modules/maps/tiled-map.parser.js';
import type {
  EmbeddedPortalDefinition,
  TiledMapJson,
} from '../src/modules/maps/tiled-map.types.js';
import { SKILL_CATALOG } from '../src/modules/skills/skill.catalog.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));

interface MapSeedDefinition {
  key: string;
  name: string;
  fileName: string;
  zoneType: 'SAFE' | 'OUTLAW' | 'PVP';
  spawnX: number;
  spawnY: number;
}

interface PreparedMap extends MapSeedDefinition {
  tiledMap: TiledMapJson;
  collision: Uint8Array;
  portals: EmbeddedPortalDefinition[];
}

interface MobSeedDefinition {
  key: string;
  name: string;
  mapKey: string;
  level: number;
  outfitKey: string;
  spawnPoints: Array<{ x: number; y: number }>;
  respawnMs: number;
  stats: Readonly<Record<string, unknown>>;
  lootTableKey: string;
}

const mapDefinitions: readonly MapSeedDefinition[] = [
  {
    key: 'greenfields',
    name: 'Greenfields',
    fileName: 'greenfields.json',
    zoneType: 'SAFE',
    spawnX: 4,
    spawnY: 4,
  },
  {
    key: 'crystal-cave',
    name: 'Crystal Cave',
    fileName: 'crystal-cave.json',
    zoneType: 'OUTLAW',
    spawnX: 3,
    spawnY: 3,
  },
];

const baseItems: readonly ContentItemDefinition[] = [
  {
    key: 'traveler-sword',
    name: 'Traveler Sword',
    description: 'A dependable steel blade for a beginning warrior.',
    stackLimit: 1,
    metadata: {
      category: 'EQUIPMENT',
      rarity: 'COMMON',
      icon: '⚔',
      equipmentSlot: 'MAIN_HAND',
      requiredClass: 'WARRIOR',
      minimumLevel: 5,
      statBonuses: { strength: 3 },
      buyPriceSilver: 180,
      sellPriceSilver: 72,
    },
  },
  {
    key: 'apprentice-staff',
    name: 'Apprentice Staff',
    description: 'A simple focus for novice spellcasters.',
    stackLimit: 1,
    metadata: {
      category: 'EQUIPMENT',
      rarity: 'ARTIFACT',
      icon: '✦',
      equipmentSlot: 'MAIN_HAND',
      requiredClass: 'MAGE',
      minimumLevel: 5,
      statBonuses: { intelligence: 3, maxEnergy: 10 },
      buyPriceSilver: 180,
      sellPriceSilver: 72,
    },
  },
  {
    key: 'field-bow',
    name: 'Field Bow',
    description: 'A light bow made for quick shots.',
    stackLimit: 1,
    metadata: {
      category: 'EQUIPMENT',
      rarity: 'MYTHIC',
      icon: '➶',
      equipmentSlot: 'MAIN_HAND',
      requiredClass: 'ARCHER',
      minimumLevel: 5,
      statBonuses: { agility: 3 },
      buyPriceSilver: 180,
      sellPriceSilver: 72,
    },
  },
  {
    key: 'minor-health-potion',
    name: 'Minor Health Potion',
    description: 'Restores 35 health.',
    stackLimit: 20,
    metadata: {
      category: 'CONSUMABLE',
      rarity: 'COMMON',
      icon: '◆',
      effect: { hp: 35 },
      buyPriceSilver: 24,
      sellPriceSilver: 9,
    },
  },
  {
    key: 'field-rations',
    name: 'Field Rations',
    description: 'Restores 30 energy.',
    stackLimit: 20,
    metadata: {
      category: 'CONSUMABLE',
      rarity: 'COMMON',
      icon: '●',
      effect: { energy: 30 },
      buyPriceSilver: 18,
      sellPriceSilver: 7,
    },
  },
  {
    key: 'town-scroll',
    name: 'Town Scroll',
    description: 'A dormant scroll prepared for a future travel system.',
    stackLimit: 10,
    metadata: {
      category: 'QUEST',
      rarity: 'COMMON',
      icon: '▱',
      buyPriceSilver: 0,
      sellPriceSilver: 0,
      sellable: false,
    },
  },
];

const materialItems: readonly ContentItemDefinition[] = [
  {
    key: 'rabbit-fur',
    name: 'Królicze futro',
    description: 'Miękkie futro spaczonego królika.',
    stackLimit: 50,
    metadata: {
      category: 'MATERIAL',
      rarity: 'COMMON',
      icon: '◌',
      buyPriceSilver: 0,
      sellPriceSilver: 5,
      sellable: true,
    },
  },
  {
    key: 'rabbit-foot',
    name: 'Królicza łapka',
    description: 'Rzadkie trofeum z Królika Pomiotu.',
    stackLimit: 20,
    metadata: {
      category: 'MATERIAL',
      rarity: 'COMMON',
      icon: '♧',
      buyPriceSilver: 0,
      sellPriceSilver: 22,
      sellable: true,
    },
  },
  {
    key: 'scorpion-chitin',
    name: 'Chityna skorpiona',
    description: 'Twarda płyta pancerza Skorpiona Kata.',
    stackLimit: 50,
    metadata: {
      category: 'MATERIAL',
      rarity: 'COMMON',
      icon: '⬡',
      buyPriceSilver: 0,
      sellPriceSilver: 14,
      sellable: true,
    },
  },
  {
    key: 'scorpion-stinger',
    name: 'Żądło skorpiona',
    description: 'Ostre żądło przydatne w rzemiośle.',
    stackLimit: 20,
    metadata: {
      category: 'MATERIAL',
      rarity: 'COMMON',
      icon: '⌁',
      buyPriceSilver: 0,
      sellPriceSilver: 44,
      sellable: true,
    },
  },
  {
    key: 'venom-sac',
    name: 'Woreczek jadowy',
    description: 'Rzadki gruczoł jadowy Skorpiona Kata.',
    stackLimit: 10,
    metadata: {
      category: 'MATERIAL',
      rarity: 'COMMON',
      icon: '◆',
      buyPriceSilver: 0,
      sellPriceSilver: 90,
      sellable: true,
    },
  },
];

const mobDefinitions: readonly MobSeedDefinition[] = [
  {
    key: 'spawn-rabbit',
    name: 'Królik',
    mapKey: 'greenfields',
    level: 2,
    outfitKey: 'mob-spawn-rabbit',
    spawnPoints: [
      { x: 9, y: 8 },
      { x: 12, y: 10 },
      { x: 18, y: 12 },
      { x: 22, y: 8 },
      { x: 24, y: 15 },
      { x: 14, y: 17 },
      { x: 7, y: 15 },
    ],
    respawnMs: 15_000,
    stats: {
      rank: 'SPAWN',
      characterClass: 'ARCHER',
      renderScale: 0.5,
      experience: 28,
      maxHp: 72,
      maxEnergy: 0,
      strength: 9,
      agility: 12,
      intelligence: 1,
      armor: 3,
    },
    lootTableKey: 'spawn-rabbit-loot',
  },
  {
    key: 'executioner-scorpion',
    name: 'Skorpion',
    mapKey: 'crystal-cave',
    level: 7,
    outfitKey: 'mob-executioner-scorpion',
    spawnPoints: [
      { x: 8, y: 7 },
      { x: 13, y: 11 },
      { x: 19, y: 9 },
      { x: 22, y: 14 },
      { x: 16, y: 17 },
      { x: 9, y: 16 },
      { x: 23, y: 6 },
    ],
    respawnMs: 30_000,
    stats: {
      rank: 'EXECUTIONER',
      characterClass: 'WARRIOR',
      renderScale: 0.85,
      experience: 145,
      maxHp: 310,
      maxEnergy: 0,
      strength: 31,
      agility: 18,
      intelligence: 3,
      armor: 17,
    },
    lootTableKey: 'executioner-scorpion-loot',
  },
];

const borinDialogue: ContentDialogueDefinition = {
  type: 'MERCHANT',
  rootNodeId: 'welcome',
  nodes: {
    welcome: {
      text: {
        pl: 'Witaj podróżniku, czy chcesz zobaczyć moje towary?',
        en: 'Welcome, traveler. Would you like to see my wares?',
      },
      choices: [
        {
          id: 'show-offer',
          label: { pl: 'Pokaż mi co masz w ofercie!', en: 'Show me what you have for sale!' },
          action: 'OPEN_MERCHANT',
        },
        {
          id: 'decline',
          label: { pl: 'Nie, dziękuję', en: 'No, thank you' },
          action: 'CLOSE',
        },
      ],
    },
  },
  merchant: {
    itemKeys: [
      'traveler-sword',
      'apprentice-staff',
      'field-bow',
      'minor-health-potion',
      'field-rations',
    ],
    infiniteStock: true,
  },
};

const questKey = 'rabbit-fur-for-mira';
const miraDialogue: ContentDialogueDefinition = {
  type: 'QUEST',
  rootNodeId: 'need-help',
  quest: {
    questKey,
    rootNodes: {
      notStarted: 'need-help',
      active: 'waiting',
      ready: 'ready',
      rewarded: 'after',
    },
  },
  nodes: {
    'need-help': {
      text: {
        pl: 'Dobrze, że jesteś! Nocami robi się tu przeraźliwie zimno, a ja szyję koce dla dzieci z Greenfields. Potrzebuję pięciu króliczych futer, ale sama nie dam rady przegonić tych spaczonych bestii.',
        en: 'I am glad you came! The nights are bitterly cold, and I am sewing blankets for the children of Greenfields. I need five rabbit furs, but I cannot face those corrupted beasts alone.',
      },
      choices: [
        {
          id: 'accept',
          label: { pl: 'Pomogę ci. Zdobędę pięć futer.', en: 'I will help. I will bring five furs.' },
          questAction: { type: 'ACCEPT', questKey, successNodeId: 'accepted' },
        },
        { id: 'decline', label: { pl: 'Nie teraz.', en: 'Not now.' }, action: 'CLOSE' },
      ],
    },
    accepted: {
      text: {
        pl: 'Dziękuję! Króliki Pomiotu kręcą się po całych Greenfields. Przynieś mi pięć futer, a porządnie cię wynagrodzę.',
        en: 'Thank you! Spawn Rabbits roam all over Greenfields. Bring me five furs and I will reward you properly.',
      },
      choices: [{ id: 'leave', label: { pl: 'Wrócę z futrami.', en: 'I will return with the furs.' }, action: 'CLOSE' }],
    },
    waiting: {
      text: {
        pl: 'Koce czekają. Masz już dla mnie pięć króliczych futer?',
        en: 'The blankets are waiting. Do you have five rabbit furs for me?',
      },
      choices: [
        {
          id: 'turn-in',
          label: { pl: 'Mam dla ciebie futra.', en: 'I have the furs for you.' },
          questAction: {
            type: 'TURN_IN',
            questKey,
            successNodeId: 'thanks',
            incompleteNodeId: 'missing',
          },
        },
        { id: 'leave', label: { pl: 'Jeszcze ich szukam.', en: 'I am still looking.' }, action: 'CLOSE' },
      ],
    },
    ready: {
      text: {
        pl: 'Widzę, że masz komplet futer. Czy to wszystko dla mnie?',
        en: 'I can see you have all the fur. Is it for me?',
      },
      choices: [
        {
          id: 'turn-in',
          label: { pl: 'Tak, weź pięć futer.', en: 'Yes, take five furs.' },
          questAction: {
            type: 'TURN_IN',
            questKey,
            successNodeId: 'thanks',
            incompleteNodeId: 'missing',
          },
        },
        { id: 'leave', label: { pl: 'Jeszcze nie.', en: 'Not yet.' }, action: 'CLOSE' },
      ],
    },
    missing: {
      text: {
        pl: 'Nie naliczyłam pięciu futer. Wróć, gdy naprawdę będziesz mieć komplet.',
        en: 'That is fewer than five furs. Return when you have the full set.',
      },
      choices: [{ id: 'leave', label: { pl: 'Zdobędę resztę.', en: 'I will find the rest.' }, action: 'CLOSE' }],
    },
    thanks: {
      text: {
        pl: 'Są idealne! Jeszcze dziś uszyję z nich ciepłe podszycia. Dziękuję — uratowałeś dzieciom niejedną zimną noc.',
        en: 'They are perfect! I will sew warm linings tonight. Thank you — you have spared the children many cold nights.',
      },
      choices: [{ id: 'leave', label: { pl: 'Cieszę się, że pomogłem.', en: 'I am glad I could help.' }, action: 'CLOSE' }],
    },
    after: {
      text: {
        pl: 'Koce są już gotowe, a dzieci pierwszy raz od dawna spały spokojnie. Tego, co zrobiłeś, nie zapomnę.',
        en: 'The blankets are finished, and the children slept peacefully. I will not forget what you did.',
      },
      choices: [
        { id: 'ask', label: { pl: 'Jak radzi sobie osada?', en: 'How is the settlement doing?' }, nextNodeId: 'after-story' },
        { id: 'leave', label: { pl: 'Do zobaczenia, Miro.', en: 'Until next time, Mira.' }, action: 'CLOSE' },
      ],
    },
    'after-story': {
      text: {
        pl: 'Lepiej niż wcześniej. Nadal brakuje nam rąk do pracy, ale przynajmniej noc nie odbiera już ludziom sił.',
        en: 'Better than before. We still lack helping hands, but the cold no longer steals everyone’s strength.',
      },
      choices: [{ id: 'leave', label: { pl: 'Powodzenia.', en: 'Good luck.' }, action: 'CLOSE' }],
    },
  },
};

const rabbitQuest: ContentQuestDefinition = {
  key: questKey,
  name: 'Ciepło dla Greenfields',
  description: 'Zdobądź pięć króliczych futer dla Miry, aby mogła uszyć ciepłe koce dla dzieci z osady.',
  minimumLevel: 1,
  steps: [
    {
      id: 'collect-rabbit-fur',
      type: 'COLLECT_ITEM',
      itemKey: 'rabbit-fur',
      quantity: 5,
      consumeOnComplete: true,
      label: { pl: 'Zdobądź królicze futra', en: 'Collect rabbit furs' },
    },
  ],
  rewards: { experience: 180, gold: 0, silver: 300 },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

async function resolveExternalTilesets(input: unknown, mapPath: string): Promise<unknown> {
  if (!isRecord(input) || !Array.isArray(input.tilesets)) return input;
  const tilesets = await Promise.all(
    input.tilesets.map(async (tileset) => {
      if (!isRecord(tileset) || typeof tileset.source !== 'string' || !tileset.source.trim()) return tileset;
      const tilesetPath = resolve(dirname(mapPath), tileset.source);
      if (!['.json', '.tsj'].includes(extname(tilesetPath).toLowerCase())) {
        throw new Error(`External tileset ${tileset.source} must be exported as Tiled JSON (.tsj).`);
      }
      const external = JSON.parse(await readFile(tilesetPath, 'utf8')) as unknown;
      if (!isRecord(external)) throw new Error(`External tileset ${tileset.source} is malformed.`);
      return { ...external, firstgid: tileset.firstgid, source: tileset.source };
    }),
  );
  return { ...input, tilesets };
}

async function loadMap(fileName: string): Promise<TiledMapJson> {
  const mapPath = resolve(currentDirectory, 'maps', fileName);
  const raw = JSON.parse(await readFile(mapPath, 'utf8')) as unknown;
  return parseTiledMap(await resolveExternalTilesets(raw, mapPath));
}

const inside = (map: PreparedMap, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < map.tiledMap.width && y < map.tiledMap.height;

function walkable(map: PreparedMap, x: number, y: number): boolean {
  return inside(map, x, y) && map.collision[y * map.tiledMap.width + x] !== 1;
}

function findNearestOpenTile(
  map: PreparedMap,
  requested: { x: number; y: number },
  reserved: Set<string>,
): { x: number; y: number } {
  const queue = [
    {
      x: Math.min(Math.max(requested.x, 0), map.tiledMap.width - 1),
      y: Math.min(Math.max(requested.y, 0), map.tiledMap.height - 1),
    },
  ];
  const visited = new Set<string>();
  const deltas = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    const coordinate = `${current.x},${current.y}`;
    if (visited.has(coordinate)) continue;
    visited.add(coordinate);
    if (walkable(map, current.x, current.y) && !reserved.has(coordinate)) return current;
    for (const delta of deltas) {
      const next = { x: current.x + delta.x, y: current.y + delta.y };
      if (inside(map, next.x, next.y) && !visited.has(`${next.x},${next.y}`)) queue.push(next);
    }
  }
  throw new Error(`Map ${map.key} has no free walkable tile near ${requested.x},${requested.y}.`);
}

async function prepareMaps(): Promise<PreparedMap[]> {
  const prepared = await Promise.all(
    mapDefinitions.map(async (definition): Promise<PreparedMap> => {
      const tiledMap = await loadMap(definition.fileName);
      const collision = compileCollisionGrid(tiledMap);
      const map = {
        ...definition,
        tiledMap,
        collision,
        portals: extractEmbeddedPortals(tiledMap),
      };
      if (!walkable(map, definition.spawnX, definition.spawnY)) {
        throw new Error(`Map ${definition.key} has an invalid seed spawn tile.`);
      }
      return map;
    }),
  );
  const maps = new Map(prepared.map((entry) => [entry.key, entry]));
  if (maps.size !== prepared.length) throw new Error('Map seed keys must be unique.');
  for (const source of prepared) {
    for (const portal of source.portals) {
      const destination = maps.get(portal.destinationMapKey);
      if (!destination) throw new Error(`Portal on ${source.key} references unknown map ${portal.destinationMapKey}.`);
      if (!walkable(source, portal.sourceX, portal.sourceY) || !walkable(destination, portal.targetX, portal.targetY)) {
        throw new Error(`Portal on ${source.key} has an invalid source or target tile.`);
      }
    }
  }
  return prepared;
}

export async function buildGameContentManifest(): Promise<GameContentManifest> {
  const preparedMaps = await prepareMaps();
  const preparedByKey = new Map(preparedMaps.map((map) => [map.key, map]));
  const reservedByMap = new Map<string, Set<string>>();
  for (const map of preparedMaps) {
    reservedByMap.set(
      map.key,
      new Set([
        `${map.spawnX},${map.spawnY}`,
        ...map.portals.map((portal) => `${portal.sourceX},${portal.sourceY}`),
      ]),
    );
  }

  const greenfields = preparedByKey.get('greenfields');
  if (!greenfields) throw new Error('Greenfields content is required.');
  const greenfieldsReserved = reservedByMap.get('greenfields')!;
  if (!walkable(greenfields, 16, 6) || greenfieldsReserved.has('16,6')) {
    throw new Error('Borin merchant must be placed on a free Greenfields tile.');
  }
  greenfieldsReserved.add('16,6');

  const mobs: ContentMobDefinition[] = [];
  for (const definition of mobDefinitions) {
    const map = preparedByKey.get(definition.mapKey);
    const reserved = reservedByMap.get(definition.mapKey);
    if (!map || !reserved) throw new Error(`Missing map ${definition.mapKey} for mob ${definition.key}.`);
    for (const [index, requested] of definition.spawnPoints.entries()) {
      const position = findNearestOpenTile(map, requested, reserved);
      reserved.add(`${position.x},${position.y}`);
      mobs.push({
        key: `${definition.key}-${index + 1}`,
        mapKey: definition.mapKey,
        name: definition.name,
        x: position.x,
        y: position.y,
        level: definition.level,
        outfitKey: definition.outfitKey,
        stats: definition.stats,
        lootTableKey: definition.lootTableKey,
        respawnMs: definition.respawnMs,
      });
    }
  }

  const miraPosition = findNearestOpenTile(greenfields, { x: 8, y: 5 }, greenfieldsReserved);
  greenfieldsReserved.add(`${miraPosition.x},${miraPosition.y}`);
  const npcs: ContentNpcDefinition[] = [
    {
      key: 'quartermaster',
      mapKey: 'greenfields',
      name: 'Borin Żelazna Dłoń',
      x: 16,
      y: 6,
      outfitKey: 'npc-warrior-merchant',
      dialogue: borinDialogue,
    },
    {
      key: 'mira-tanner',
      mapKey: 'greenfields',
      name: 'Mira Igłopalca',
      x: miraPosition.x,
      y: miraPosition.y,
      outfitKey: 'npc-quest-mira',
      dialogue: miraDialogue,
    },
  ];

  return {
    schemaVersion: 1,
    defaultMapKey: 'greenfields',
    maps: preparedMaps.map((map) => ({
      key: map.key,
      name: map.name,
      width: map.tiledMap.width,
      height: map.tiledMap.height,
      zoneType: map.zoneType,
      spawnX: map.spawnX,
      spawnY: map.spawnY,
      tiledData: map.tiledMap,
    })),
    portals: preparedMaps.flatMap((map) =>
      map.portals.map((portal) => ({
        key: `${map.key}:${portal.sourceX},${portal.sourceY}->${portal.destinationMapKey}:${portal.targetX},${portal.targetY}`,
        sourceMapKey: map.key,
        sourceX: portal.sourceX,
        sourceY: portal.sourceY,
        destinationMapKey: portal.destinationMapKey,
        targetX: portal.targetX,
        targetY: portal.targetY,
        enabled: true,
      })),
    ),
    npcs,
    quests: [rabbitQuest],
    mobs,
    encounters: [
      {
        key: 'greenfields-rabbit-hunt',
        mapKey: 'greenfields',
        actors: [{ mobKey: 'spawn-rabbit-1', count: 1 }],
        minimumPlayers: 1,
        maximumPlayers: 10,
      },
      {
        key: 'crystal-cave-scorpion-hunt',
        mapKey: 'crystal-cave',
        actors: [{ mobKey: 'executioner-scorpion-1', count: 1 }],
        minimumPlayers: 1,
        maximumPlayers: 10,
      },
    ],
    skills: SKILL_CATALOG.map((skill) => ({
      key: skill.key,
      name: skill.name,
      description: skill.description,
      requiredClass: skill.characterClass,
      minimumLevel: skill.minimumLevel,
      energyCost: skill.energyCost,
      cooldownTurns: skill.cooldownTurns,
      targeting: skill.targeting,
      maxRank: skill.maxRank,
      displayOrder: skill.displayOrder,
      treeRow: skill.treeRow,
      treeColumn: skill.treeColumn,
      icon: skill.icon,
      animationKey: skill.animationKey,
      prerequisiteKeys: skill.prerequisiteKeys,
      effectDefinition: { operations: skill.effects },
      visualDefinition: skill.visual,
    })),
    items: [...baseItems, ...materialItems],
    lootTables: [
      {
        key: 'spawn-rabbit-loot',
        entries: [
          { itemKey: 'rabbit-fur', chance: 0.65, minQuantity: 1, maxQuantity: 2 },
          { itemKey: 'rabbit-foot', chance: 0.12, minQuantity: 1, maxQuantity: 1 },
          { itemKey: 'minor-health-potion', chance: 0.08, minQuantity: 1, maxQuantity: 1 },
        ],
      },
      {
        key: 'executioner-scorpion-loot',
        entries: [
          { itemKey: 'scorpion-chitin', chance: 0.72, minQuantity: 1, maxQuantity: 3 },
          { itemKey: 'scorpion-stinger', chance: 0.24, minQuantity: 1, maxQuantity: 1 },
          { itemKey: 'venom-sac', chance: 0.09, minQuantity: 1, maxQuantity: 1 },
          { itemKey: 'minor-health-potion', chance: 0.06, minQuantity: 1, maxQuantity: 2 },
        ],
      },
    ],
    recipes: [],
    expeditions: [],
    modifiers: [],
  };
}
