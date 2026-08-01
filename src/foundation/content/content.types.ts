export type ContentCategory =
  | 'maps'
  | 'portals'
  | 'npcs'
  | 'quests'
  | 'mobs'
  | 'encounters'
  | 'skills'
  | 'items'
  | 'lootTables'
  | 'recipes'
  | 'expeditions'
  | 'modifiers';

export interface ContentMapDefinition {
  key: string;
  width?: number;
  height?: number;
}

export interface ContentPortalDefinition {
  key: string;
  sourceMapKey: string;
  destinationMapKey: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}

export interface ContentDialogueChoice {
  id: string;
  nextNodeId?: string;
  successNodeId?: string;
  incompleteNodeId?: string;
  itemKey?: string;
  questKey?: string;
}

export interface ContentDialogueNode {
  id: string;
  choices: readonly ContentDialogueChoice[];
}

export interface ContentNpcDefinition {
  key: string;
  mapKey: string;
  x?: number;
  y?: number;
  rootNodeId?: string;
  entryNodeIds?: readonly string[];
  nodes?: readonly ContentDialogueNode[];
  questKey?: string;
  merchantItemKeys?: readonly string[];
}

export interface ContentQuestObjective {
  id: string;
  type: string;
  itemKey?: string;
  mobKey?: string;
  npcKey?: string;
  quantity?: number;
}

export interface ContentQuestReward {
  experience?: number;
  silver?: number;
  gold?: number;
  items?: readonly { itemKey: string; quantity: number }[];
}

export interface ContentQuestDefinition {
  key: string;
  objectives: readonly ContentQuestObjective[];
  rewards: ContentQuestReward;
}

export interface ContentMobDefinition {
  key: string;
  mapKey: string;
  spawnPoints: readonly { x: number; y: number }[];
  lootTableKey: string;
}

export interface ContentEncounterDefinition {
  key: string;
  mobKeys: readonly string[];
}

export interface ContentSkillDefinition {
  key: string;
  prerequisiteKeys: readonly string[];
}

export interface ContentItemDefinition {
  key: string;
}

export interface ContentLootTableDefinition {
  key: string;
  entries: readonly {
    itemKey: string;
    chance: number;
    minQuantity: number;
    maxQuantity: number;
  }[];
}

export interface ContentRecipeDefinition {
  key: string;
  ingredients: readonly { itemKey: string; quantity: number }[];
  result: { itemKey: string; quantity: number };
}

export interface ContentManifest {
  schemaVersion: number;
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
  expeditions: readonly { key: string }[];
  modifiers: readonly { key: string }[];
  sourceFingerprints?: Readonly<Record<string, string>>;
}

export interface ContentValidationIssue {
  code:
    | 'DUPLICATE_KEY'
    | 'MISSING_REFERENCE'
    | 'CYCLE'
    | 'UNREACHABLE_NODE'
    | 'POSITION_COLLISION'
    | 'INVALID_REWARD'
    | 'INVALID_LOOT'
    | 'INVALID_COORDINATE';
  path: string;
  message: string;
}

export interface CompiledContentPackage {
  hash: string;
  schemaVersion: number;
  manifest: ContentManifest;
  canonicalJson: string;
}

export interface ContentLogicalDiff {
  added: Partial<Record<ContentCategory, string[]>>;
  removed: Partial<Record<ContentCategory, string[]>>;
  changed: Partial<Record<ContentCategory, string[]>>;
}

export interface ContentSnapshotRecord {
  category: ContentCategory;
  key: string;
  payload: unknown;
}
