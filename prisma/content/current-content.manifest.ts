import { SKILL_CATALOG } from '../../src/modules/skills/skill.catalog.js';
import type {
  ContentManifest,
  ContentPortalDefinition,
} from '../../src/foundation/content/content.types.js';

const itemKeys = [
  'traveler-sword',
  'apprentice-staff',
  'field-bow',
  'minor-health-potion',
  'field-rations',
  'town-scroll',
  'rabbit-fur',
  'rabbit-foot',
  'scorpion-chitin',
  'scorpion-stinger',
  'venom-sac',
] as const;

export function buildCurrentContentManifest(
  portals: readonly ContentPortalDefinition[],
  sourceFingerprints: Readonly<Record<string, string>>,
): ContentManifest {
  return {
    schemaVersion: 1,
    maps: [
      { key: 'greenfields' },
      { key: 'crystal-cave' },
    ],
    portals,
    npcs: [
      {
        key: 'borin-merchant',
        mapKey: 'greenfields',
        x: 16,
        y: 6,
        rootNodeId: 'welcome',
        merchantItemKeys: [
          'traveler-sword',
          'apprentice-staff',
          'field-bow',
          'minor-health-potion',
          'field-rations',
        ],
        nodes: [
          {
            id: 'welcome',
            choices: [
              { id: 'show-offer' },
              { id: 'decline' },
            ],
          },
        ],
      },
      {
        key: 'mira-tanner',
        mapKey: 'greenfields',
        rootNodeId: 'need-help',
        entryNodeIds: ['waiting', 'ready', 'after'],
        questKey: 'rabbit-fur-for-mira',
        nodes: [
          {
            id: 'need-help',
            choices: [
              { id: 'accept', questKey: 'rabbit-fur-for-mira', successNodeId: 'accepted' },
              { id: 'decline' },
            ],
          },
          { id: 'accepted', choices: [{ id: 'leave' }] },
          {
            id: 'waiting',
            choices: [
              {
                id: 'turn-in',
                questKey: 'rabbit-fur-for-mira',
                successNodeId: 'thanks',
                incompleteNodeId: 'missing',
              },
              { id: 'leave' },
            ],
          },
          {
            id: 'ready',
            choices: [
              {
                id: 'turn-in',
                questKey: 'rabbit-fur-for-mira',
                successNodeId: 'thanks',
                incompleteNodeId: 'missing',
              },
              { id: 'leave' },
            ],
          },
          { id: 'missing', choices: [{ id: 'leave' }] },
          { id: 'thanks', choices: [{ id: 'leave' }] },
          {
            id: 'after',
            choices: [
              { id: 'ask', nextNodeId: 'after-story' },
              { id: 'leave' },
            ],
          },
          { id: 'after-story', choices: [{ id: 'leave' }] },
        ],
      },
    ],
    quests: [
      {
        key: 'rabbit-fur-for-mira',
        objectives: [
          {
            id: 'collect-rabbit-fur',
            type: 'COLLECT_ITEM',
            itemKey: 'rabbit-fur',
            quantity: 5,
          },
        ],
        rewards: { experience: 180, silver: 300, gold: 0 },
      },
    ],
    mobs: [
      {
        key: 'spawn-rabbit',
        mapKey: 'greenfields',
        spawnPoints: [
          { x: 9, y: 8 },
          { x: 12, y: 10 },
          { x: 18, y: 12 },
          { x: 22, y: 8 },
          { x: 24, y: 15 },
          { x: 14, y: 17 },
          { x: 7, y: 15 },
        ],
        lootTableKey: 'spawn-rabbit-loot',
      },
      {
        key: 'executioner-scorpion',
        mapKey: 'crystal-cave',
        spawnPoints: [
          { x: 8, y: 7 },
          { x: 13, y: 11 },
          { x: 19, y: 9 },
          { x: 22, y: 14 },
          { x: 16, y: 17 },
          { x: 9, y: 16 },
          { x: 23, y: 6 },
        ],
        lootTableKey: 'executioner-scorpion-loot',
      },
    ],
    encounters: [
      { key: 'greenfields-rabbit-pack', mobKeys: ['spawn-rabbit'] },
      { key: 'crystal-cave-scorpion-hunt', mobKeys: ['executioner-scorpion'] },
    ],
    skills: SKILL_CATALOG.map((skill) => ({
      key: skill.key,
      prerequisiteKeys: [...skill.prerequisiteKeys],
    })),
    items: itemKeys.map((key) => ({ key })),
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
    sourceFingerprints,
  };
}
