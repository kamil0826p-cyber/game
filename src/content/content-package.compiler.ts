import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileCollisionGrid, extractEmbeddedPortals, parseTiledMap } from '../modules/maps/tiled-map.parser.js';
import type { EmbeddedPortalDefinition, TiledMapJson } from '../modules/maps/tiled-map.types.js';
import { SKILL_CATALOG } from '../modules/skills/skill.catalog.js';
import { BORIN_MERCHANT, CONTENT_ITEMS, CONTENT_MAPS, CONTENT_MOBS, CONTENT_SCHEMA_VERSION, CURRENT_CONTENT_VERSION, type ContentMapDefinition } from './current-content.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
interface PreparedMap extends ContentMapDefinition { tiledMap: TiledMapJson; collision: Uint8Array; portals: EmbeddedPortalDefinition[] }

export interface CompiledContentManifest {
  schemaVersion: number;
  version: string;
  realm: { slug: string; name: string; defaultMapKey: string };
  maps: Array<{ key: string; name: string; width: number; height: number; zoneType: 'SAFE' | 'OUTLAW' | 'PVP'; spawnX: number; spawnY: number; tiledData: TiledMapJson; portals: EmbeddedPortalDefinition[] }>;
  items: Array<(typeof CONTENT_ITEMS)[number]>;
  npcs: Array<typeof BORIN_MERCHANT>;
  mobs: Array<{ key: string; familyKey: string; name: string; mapKey: string; x: number; y: number; level: number; outfitKey: string; respawnMs: number; stats: (typeof CONTENT_MOBS)[number]['stats']; lootTable: (typeof CONTENT_MOBS)[number]['lootTable'] }>;
  skills: Array<{ key: string; name: string; description: string; characterClass: 'MAGE' | 'WARRIOR' | 'ARCHER'; minimumLevel: number; energyCost: number; cooldownTurns: number; targeting: 'SELF' | 'ENEMY' | 'AREA'; maxRank: number; displayOrder: number; treeRow: number; treeColumn: number; icon: string; prerequisiteKeys: string[]; effects: unknown[]; animationKey: string; visual: Record<string, unknown> }>;
  quests: Array<Record<string, unknown>>;
}
export interface CompiledContentPackage { manifest: CompiledContentManifest; sourceHash: string }
export interface ContentDiff { added: string[]; changed: string[]; removed: string[]; risky: string[] }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stableValue(child)]));
}
export function stableStringify(value: unknown): string { return JSON.stringify(stableValue(value)); }

async function resolveExternalTilesets(input: unknown, mapPath: string): Promise<unknown> {
  if (!isRecord(input) || !Array.isArray(input.tilesets)) return input;
  return {
    ...input,
    tilesets: await Promise.all(input.tilesets.map(async (tileset) => {
      if (!isRecord(tileset) || typeof tileset.source !== 'string' || !tileset.source.trim()) return tileset;
      const tilesetPath = resolve(dirname(mapPath), tileset.source);
      if (!['.json', '.tsj'].includes(extname(tilesetPath).toLowerCase())) throw new Error(`External tileset ${tileset.source} must be JSON.`);
      const external = JSON.parse(await readFile(tilesetPath, 'utf8')) as unknown;
      if (!isRecord(external)) throw new Error(`External tileset ${tileset.source} is malformed.`);
      return { ...external, firstgid: tileset.firstgid, source: tileset.source };
    })),
  };
}
async function loadMap(fileName: string): Promise<TiledMapJson> {
  const path = resolve(currentDirectory, '../../prisma/maps', fileName);
  return parseTiledMap(await resolveExternalTilesets(JSON.parse(await readFile(path, 'utf8')) as unknown, path));
}
function inside(map: PreparedMap, x: number, y: number): boolean { return x >= 0 && y >= 0 && x < map.tiledMap.width && y < map.tiledMap.height; }
function unique(kind: string, keys: readonly string[]): void {
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  if (duplicates.length) throw new Error(`${kind} keys must be unique: ${[...new Set(duplicates)].join(', ')}.`);
}
function validateSkillGraph(): void {
  const byKey = new Map(SKILL_CATALOG.map((skill) => [skill.key, skill]));
  for (const skill of SKILL_CATALOG) for (const dependency of skill.prerequisiteKeys) if (!byKey.has(dependency)) throw new Error(`Skill ${skill.key} references ${dependency}.`);
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (key: string): void => {
    if (visiting.has(key)) throw new Error(`Skill prerequisite cycle contains ${key}.`);
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of byKey.get(key)?.prerequisiteKeys ?? []) visit(dependency);
    visiting.delete(key); visited.add(key);
  };
  for (const key of byKey.keys()) visit(key);
}
function nearestMobTile(map: PreparedMap, requested: { x: number; y: number }, reserved: Set<string>): { x: number; y: number } {
  const blocked = new Set(map.portals.map((portal) => `${portal.sourceX},${portal.sourceY}`));
  blocked.add(`${map.spawnX},${map.spawnY}`);
  if (map.key === BORIN_MERCHANT.mapKey) blocked.add(`${BORIN_MERCHANT.x},${BORIN_MERCHANT.y}`);
  const queue = [{ x: Math.min(Math.max(requested.x, 0), map.tiledMap.width - 1), y: Math.min(Math.max(requested.y, 0), map.tiledMap.height - 1) }];
  const visited = new Set<string>(); const deltas = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!; const key = `${current.x},${current.y}`;
    if (visited.has(key)) continue; visited.add(key);
    if (inside(map, current.x, current.y) && map.collision[current.y * map.tiledMap.width + current.x] !== 1 && !blocked.has(key) && !reserved.has(key)) return current;
    for (const [dx, dy] of deltas) { const next = { x: current.x + dx, y: current.y + dy }; if (inside(map, next.x, next.y) && !visited.has(`${next.x},${next.y}`)) queue.push(next); }
  }
  throw new Error(`Map ${map.key} has no free tile for mob ${requested.x},${requested.y}.`);
}
async function prepareMaps(): Promise<PreparedMap[]> {
  const maps = await Promise.all(CONTENT_MAPS.map(async (definition) => {
    const tiledMap = await loadMap(definition.fileName); const collision = compileCollisionGrid(tiledMap);
    if (!inside({ ...definition, tiledMap, collision, portals: [] }, definition.spawnX, definition.spawnY) || collision[definition.spawnY * tiledMap.width + definition.spawnX] === 1) throw new Error(`Map ${definition.key} has invalid spawn.`);
    return { ...definition, tiledMap, collision, portals: extractEmbeddedPortals(tiledMap) };
  }));
  unique('Map', maps.map((map) => map.key)); const byKey = new Map(maps.map((map) => [map.key, map]));
  for (const source of maps) for (const portal of source.portals) {
    const target = byKey.get(portal.destinationMapKey);
    const sourceValid = inside(source, portal.sourceX, portal.sourceY) && source.collision[portal.sourceY * source.tiledMap.width + portal.sourceX] !== 1;
    const targetValid = target && inside(target, portal.targetX, portal.targetY) && target.collision[portal.targetY * target.tiledMap.width + portal.targetX] !== 1;
    if (!target || !sourceValid || !targetValid) throw new Error(`Portal on ${source.key} has invalid source or target.`);
  }
  const merchantMap = byKey.get(BORIN_MERCHANT.mapKey);
  if (!merchantMap || !inside(merchantMap, BORIN_MERCHANT.x, BORIN_MERCHANT.y) || merchantMap.collision[BORIN_MERCHANT.y * merchantMap.tiledMap.width + BORIN_MERCHANT.x] === 1) throw new Error(`${BORIN_MERCHANT.name} is not walkable.`);
  return maps;
}

export async function compileCurrentContent(options: { realmSlug: string; realmName: string }): Promise<CompiledContentPackage> {
  unique('Item', CONTENT_ITEMS.map((item) => item.key)); unique('Mob family', CONTENT_MOBS.map((mob) => mob.key)); unique('Skill', SKILL_CATALOG.map((skill) => skill.key)); validateSkillGraph();
  const itemKeys = new Set(CONTENT_ITEMS.map((item) => item.key));
  for (const key of BORIN_MERCHANT.dialogue.merchant.itemKeys) if (!itemKeys.has(key)) throw new Error(`Merchant references missing item ${key}.`);
  for (const mob of CONTENT_MOBS) for (const loot of mob.lootTable) {
    if (!itemKeys.has(loot.itemKey)) throw new Error(`Mob ${mob.key} references missing item ${loot.itemKey}.`);
    if (loot.chance < 0 || loot.chance > 1 || loot.minQuantity < 1 || loot.maxQuantity < loot.minQuantity) throw new Error(`Mob ${mob.key} has invalid loot ${loot.itemKey}.`);
  }
  const prepared = await prepareMaps(); const byKey = new Map(prepared.map((map) => [map.key, map])); const reserved = new Map<string, Set<string>>();
  const mobs: CompiledContentManifest['mobs'] = [];
  for (const family of CONTENT_MOBS) {
    const map = byKey.get(family.mapKey); if (!map) throw new Error(`Mob ${family.key} references missing map ${family.mapKey}.`);
    const occupied = reserved.get(family.mapKey) ?? new Set<string>(); reserved.set(family.mapKey, occupied);
    family.spawnPoints.forEach((requested, index) => { const position = nearestMobTile(map, requested, occupied); occupied.add(`${position.x},${position.y}`); mobs.push({ key: `${family.key}-${index + 1}`, familyKey: family.key, name: family.name, mapKey: family.mapKey, x: position.x, y: position.y, level: family.level, outfitKey: family.outfitKey, respawnMs: family.respawnMs, stats: family.stats, lootTable: family.lootTable }); });
  }
  const manifest: CompiledContentManifest = {
    schemaVersion: CONTENT_SCHEMA_VERSION, version: CURRENT_CONTENT_VERSION,
    realm: { slug: options.realmSlug, name: options.realmName, defaultMapKey: 'greenfields' },
    maps: prepared.map((map) => ({ key: map.key, name: map.name, width: map.tiledMap.width, height: map.tiledMap.height, zoneType: map.zoneType, spawnX: map.spawnX, spawnY: map.spawnY, tiledData: map.tiledMap, portals: [...map.portals].sort((a, b) => `${a.sourceX},${a.sourceY}`.localeCompare(`${b.sourceX},${b.sourceY}`)) })).sort((a, b) => a.key.localeCompare(b.key)),
    items: [...CONTENT_ITEMS].sort((a, b) => a.key.localeCompare(b.key)), npcs: [BORIN_MERCHANT], mobs: mobs.sort((a, b) => a.key.localeCompare(b.key)),
    skills: SKILL_CATALOG.map((skill) => ({ key: skill.key, name: skill.name, description: skill.description, characterClass: skill.characterClass, minimumLevel: skill.minimumLevel, energyCost: skill.energyCost, cooldownTurns: skill.cooldownTurns, targeting: skill.targeting, maxRank: skill.maxRank, displayOrder: skill.displayOrder, treeRow: skill.treeRow, treeColumn: skill.treeColumn, icon: skill.icon, prerequisiteKeys: [...skill.prerequisiteKeys], effects: [...skill.effects], animationKey: skill.animationKey, visual: { ...skill.visual } })).sort((a, b) => a.key.localeCompare(b.key)),
    quests: [],
  };
  return { manifest, sourceHash: createHash('sha256').update(stableStringify(manifest)).digest('hex') };
}

function entities(manifest: CompiledContentManifest | null): Map<string, string> {
  if (!manifest) return new Map(); const entries: Array<[string, unknown]> = [];
  manifest.maps.forEach((value) => entries.push([`map:${value.key}`, value])); manifest.items.forEach((value) => entries.push([`item:${value.key}`, value])); manifest.npcs.forEach((value) => entries.push([`npc:${value.mapKey}:${value.key}`, value])); manifest.mobs.forEach((value) => entries.push([`mob:${value.mapKey}:${value.key}`, value])); manifest.skills.forEach((value) => entries.push([`skill:${value.key}`, value])); manifest.quests.forEach((value) => entries.push([`quest:${typeof value.key === 'string' ? value.key : stableStringify(value)}`, value]));
  return new Map(entries.map(([key, value]) => [key, stableStringify(value)]));
}
export function diffContent(previous: CompiledContentManifest | null, next: CompiledContentManifest): ContentDiff {
  const before = entities(previous); const after = entities(next);
  const added = [...after.keys()].filter((key) => !before.has(key)).sort(); const removed = [...before.keys()].filter((key) => !after.has(key)).sort(); const changed = [...after.keys()].filter((key) => before.has(key) && before.get(key) !== after.get(key)).sort();
  return { added, changed, removed, risky: [...removed, ...changed.filter((key) => key.startsWith('map:') || key.startsWith('quest:'))].sort() };
}
