export type ContentZoneType = 'SAFE' | 'OUTLAW' | 'PVP';
export type ContentCharacterClass = 'MAGE' | 'WARRIOR' | 'ARCHER';
export type ContentSkillTargeting = 'SELF' | 'ENEMY' | 'AREA';

export interface ContentMapDefinition {
  key: string;
  name: string;
  width: number;
  height: number;
  zoneType: ContentZoneType;
  spawnX: number;
  spawnY: number;
  tiledData: unknown;
}

export interface ContentPortalDefinition {
  key: string;
  sourceMapKey: string;
  sourceX: number;
  sourceY: number;
  destinationMapKey: string;
  targetX: number;
  targetY: number;
  enabled: boolean;
}

export interface ContentDialogueChoice {
  id: string;
  nextNodeId?: string;
  action?: string;
  questAction?: {
    type: string;
    questKey: string;
    successNodeId?: string;
    incompleteNodeId?: string;
  };
  [key: string]: unknown;
}

export interface ContentDialogueNode {
  choices?: readonly ContentDialogueChoice[];
  allowCycle?: boolean;
  [key: string]: unknown;
}

export interface ContentDialogueDefinition {
  rootNodeId: string;
  nodes: Readonly<Record<string, ContentDialogueNode>>;
  merchant?: { itemKeys: readonly string[]; [key: string]: unknown };
  quest?: {
    questKey: string;
    rootNodes?: Readonly<Record<string, string>>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ContentNpcDefinition {
  key: string;
  mapKey: string;
  name: string;
  x: number;
  y: number;
  outfitKey: string;
  dialogue: ContentDialogueDefinition;
}

export interface ContentItemDefinition {
  key: string;
  name: string;
  description: string;
  stackLimit: number;
  metadata: Readonly<Record<string, unknown>>;
}

export interface ContentLootEntry {
  itemKey: string;
  chance: number;
  minQuantity: number;
  maxQuantity: number;
}

export interface ContentLootTableDefinition {
  key: string;
  entries: readonly ContentLootEntry[];
}

export interface ContentMobDefinition {
  key: string;
  mapKey: string;
  name: string;
  x: number;
  y: number;
  level: number;
  outfitKey: string;
  stats: Readonly<Record<string, unknown>>;
  lootTableKey: string;
  respawnMs: number;
}

export interface ContentEncounterActor {
  mobKey: string;
  count: number;
}

export interface ContentEncounterDefinition {
  key: string;
  mapKey: string;
  actors: readonly ContentEncounterActor[];
  minimumPlayers: number;
  maximumPlayers: number;
  modifiers?: readonly string[];
}

export interface ContentSkillDefinition {
  key: string;
  name: string;
  description: string;
  requiredClass?: ContentCharacterClass;
  minimumLevel: number;
  energyCost: number;
  cooldownTurns: number;
  targeting: ContentSkillTargeting;
  maxRank: number;
  displayOrder: number;
  treeRow: number;
  treeColumn: number;
  icon: string;
  animationKey: string;
  prerequisiteKeys: readonly string[];
  effectDefinition: unknown;
  visualDefinition: unknown;
}

export interface ContentQuestStep {
  id: string;
  type: string;
  itemKey?: string;
  mobKey?: string;
  npcKey?: string;
  quantity?: number;
  [key: string]: unknown;
}

export interface ContentQuestRewards {
  experience?: number;
  silver?: number;
  gold?: number;
  items?: readonly { itemKey: string; quantity: number }[];
  [key: string]: unknown;
}

export interface ContentQuestDefinition {
  key: string;
  name: string;
  description: string;
  minimumLevel: number;
  steps: readonly ContentQuestStep[];
  rewards: ContentQuestRewards;
}

export interface ContentRecipeDefinition {
  key: string;
  ingredients: readonly { itemKey: string; quantity: number }[];
  outputs: readonly { itemKey: string; quantity: number }[];
}

export interface ContentExpeditionDefinition {
  key: string;
  encounterKeys: readonly string[];
  modifierKeys: readonly string[];
  [key: string]: unknown;
}

export interface ContentModifierDefinition {
  key: string;
  [key: string]: unknown;
}

export interface GameContentManifest {
  schemaVersion: 1;
  defaultMapKey: string;
  maps: readonly ContentMapDefinition[];
  portals: readonly ContentPortalDefinition[];
  npcs: readonly ContentNpcDefinition[];
  quests: readonly ContentQuestDefinition[];
  mobs: readonly ContentMobDefinition[];
  encounters: readonly ContentEncounterDefinition[];
  skills: readonly ContentSkillDefinition[];
  items: readonly ContentItemDefinition[];
  lootTables: readonly ContentLootTableDefinition[];
  recipes: readonly ContentRecipeDefinition[];
  expeditions: readonly ContentExpeditionDefinition[];
  modifiers: readonly ContentModifierDefinition[];
}

export const CONTENT_SECTIONS = [
  'maps',
  'portals',
  'npcs',
  'quests',
  'mobs',
  'encounters',
  'skills',
  'items',
  'lootTables',
  'recipes',
  'expeditions',
  'modifiers',
] as const;

export type ContentSectionName = (typeof CONTENT_SECTIONS)[number];

export interface ContentSectionDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

export type ContentLogicalDiff = Record<ContentSectionName, ContentSectionDiff>;

export interface CompiledContentPackage {
  hash: string;
  canonicalJson: string;
  manifest: GameContentManifest;
  logicalDiff: ContentLogicalDiff;
}
