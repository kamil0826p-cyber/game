import { createHash } from 'node:crypto';
import type { EmbeddedPortalDefinition, TiledMapJson } from '../modules/maps/tiled-map.types.js';
import type { SkillTargeting } from '../modules/skills/skill.types.js';
import type {
  ContentEncounterDefinition,
  ContentExpeditionDefinition,
  ContentItemDefinition,
  ContentQuestDefinition,
  ContentRecipeDefinition,
} from './current-content.js';

export interface CompiledContentManifest {
  schemaVersion: number;
  version: string;
  realm: { slug: string; name: string; defaultMapKey: string };
  maps: Array<{
    key: string;
    name: string;
    width: number;
    height: number;
    zoneType: 'SAFE' | 'OUTLAW' | 'PVP';
    spawnX: number;
    spawnY: number;
    tiledData: TiledMapJson;
    portals: EmbeddedPortalDefinition[];
  }>;
  items: ContentItemDefinition[];
  npcs: Array<{
    key: string;
    name: string;
    mapKey: string;
    x: number;
    y: number;
    outfitKey: string;
    dialogue: Record<string, unknown>;
  }>;
  mobs: Array<{
    key: string;
    familyKey: string;
    name: string;
    mapKey: string;
    x: number;
    y: number;
    level: number;
    outfitKey: string;
    respawnMs: number;
    stats: Record<string, unknown>;
    lootTable: Array<{
      itemKey: string;
      chance: number;
      minQuantity: number;
      maxQuantity: number;
    }>;
  }>;
  skills: Array<{
    key: string;
    name: string;
    description: string;
    characterClass: 'MAGE' | 'WARRIOR' | 'ARCHER';
    minimumLevel: number;
    energyCost: number;
    cooldownTurns: number;
    targeting: SkillTargeting;
    maxRank: number;
    displayOrder: number;
    treeRow: number;
    treeColumn: number;
    icon: string;
    prerequisiteKeys: string[];
    effects: unknown[];
    animationKey: string;
    visual: Record<string, unknown>;
    telegraph?: {
      reactionWindowMs: number;
      publicIntent: string;
      interruptible: boolean;
      counters: Array<'INTERRUPT' | 'GUARD' | 'INTERCEPT' | 'CLEANSE'>;
    };
  }>;
  quests: ContentQuestDefinition[];
  encounters: ContentEncounterDefinition[];
  recipes: ContentRecipeDefinition[];
  expeditions: ContentExpeditionDefinition[];
}

export interface CompiledContentPackage {
  manifest: CompiledContentManifest;
  sourceHash: string;
}
export type ContentChangeType = 'ADDED' | 'CHANGED' | 'REMOVED';
export interface ContentDiffEntry {
  entityKey: string;
  changeType: ContentChangeType;
  beforeHash?: string;
  afterHash?: string;
  risky: boolean;
  riskReason?: string;
}
export interface ContentDiff {
  added: string[];
  changed: string[];
  removed: string[];
  risky: string[];
  entries: ContentDiffEntry[];
}
export const emptyContentDiff = (): ContentDiff => ({
  added: [],
  changed: [],
  removed: [],
  risky: [],
  entries: [],
});
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}
export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}
export function contentHash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}
