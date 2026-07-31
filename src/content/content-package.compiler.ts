import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileCollisionGrid, extractEmbeddedPortals, parseTiledMap } from '../modules/maps/tiled-map.parser.js';
import type { EmbeddedPortalDefinition, TiledMapJson } from '../modules/maps/tiled-map.types.js';
import { SKILL_CATALOG } from '../modules/skills/skill.catalog.js';
import { CONTENT_ENCOUNTERS, CONTENT_EXPEDITIONS, CONTENT_ITEMS, CONTENT_MAPS, CONTENT_MOBS, CONTENT_NPCS, CONTENT_QUESTS, CONTENT_RECIPES, CONTENT_SCHEMA_VERSION, CURRENT_CONTENT_VERSION, type ContentMapDefinition } from './current-content.js';
import { contentHash, emptyContentDiff, isRecord, stableStringify, type CompiledContentManifest, type CompiledContentPackage, type ContentChangeType, type ContentDiff, type ContentDiffEntry } from './content-package.types.js';
import { validateCompiledManifest } from './content-package.validation.js';

export { contentHash, emptyContentDiff, isRecord, stableStringify } from './content-package.types.js';
export type { CompiledContentManifest, CompiledContentPackage, ContentChangeType, ContentDiff, ContentDiffEntry } from './content-package.types.js';
export { validateCompiledManifest } from './content-package.validation.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
interface PreparedMap extends ContentMapDefinition { tiledMap: TiledMapJson; collision: Uint8Array; portals: EmbeddedPortalDefinition[] }
async function resolveExternalTilesets(input: unknown, mapPath: string): Promise<unknown> {
  if (!isRecord(input) || !Array.isArray(input.tilesets)) return input;
  return { ...input, tilesets: await Promise.all(input.tilesets.map(async (tileset) => {
    if (!isRecord(tileset) || typeof tileset.source !== 'string' || !tileset.source.trim()) return tileset;
    const tilesetPath = resolve(dirname(mapPath), tileset.source);
    if (!['.json', '.tsj'].includes(extname(tilesetPath).toLowerCase())) throw new Error(`External tileset ${tileset.source} must be exported as Tiled JSON.`);
    const external = JSON.parse(await readFile(tilesetPath, 'utf8')) as unknown;
    if (!isRecord(external)) throw new Error(`External tileset ${tileset.source} is malformed.`);
    return { ...external, firstgid: tileset.firstgid, source: tileset.source, resolvedSourceUrl: tileset.source };
  })) };
}
async function loadMap(fileName: string): Promise<TiledMapJson> {
  const path = resolve(currentDirectory, '../../prisma/maps', fileName);
  return parseTiledMap(await resolveExternalTilesets(JSON.parse(await readFile(path, 'utf8')) as unknown, path));
}
function inside(map: PreparedMap, x: number, y: number): boolean { return x >= 0 && y >= 0 && x < map.tiledMap.width && y < map.tiledMap.height; }
function nearestFreeTile(map: PreparedMap, requested: { x: number; y: number }, reserved: Set<string>): { x: number; y: number } {
  const blocked = new Set(map.portals.map((portal) => `${portal.sourceX},${portal.sourceY}`)); blocked.add(`${map.spawnX},${map.spawnY}`);
  const queue = [{ x: Math.min(Math.max(requested.x, 0), map.tiledMap.width - 1), y: Math.min(Math.max(requested.y, 0), map.tiledMap.height - 1) }];
  const visited = new Set<string>(); const deltas = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!; const key = `${current.x},${current.y}`;
    if (visited.has(key)) continue; visited.add(key);
    if (inside(map, current.x, current.y) && map.collision[current.y * map.tiledMap.width + current.x] !== 1 && !blocked.has(key) && !reserved.has(key)) return current;
    for (const [dx, dy] of deltas) { const next = { x: current.x + dx, y: current.y + dy }; if (inside(map, next.x, next.y) && !visited.has(`${next.x},${next.y}`)) queue.push(next); }
  }
  throw new Error(`Map ${map.key} has no free walkable tile near ${requested.x},${requested.y}.`);
}
async function prepareMaps(): Promise<PreparedMap[]> {
  const maps = await Promise.all(CONTENT_MAPS.map(async (definition) => {
    const tiledMap = await loadMap(definition.fileName); const collision = compileCollisionGrid(tiledMap);
    const map = { ...definition, tiledMap, collision, portals: extractEmbeddedPortals(tiledMap) };
    if (!inside(map, definition.spawnX, definition.spawnY) || collision[definition.spawnY * tiledMap.width + definition.spawnX] === 1) throw new Error(`Map ${definition.key} has invalid spawn.`);
    return map;
  }));
  const byKey = new Map(maps.map((map) => [map.key, map]));
  for (const source of maps) for (const portal of source.portals) {
    const target = byKey.get(portal.destinationMapKey);
    const sourceValid = inside(source, portal.sourceX, portal.sourceY) && source.collision[portal.sourceY * source.tiledMap.width + portal.sourceX] !== 1;
    const targetValid = target && inside(target, portal.targetX, portal.targetY) && target.collision[portal.targetY * target.tiledMap.width + portal.targetX] !== 1;
    if (!target || !sourceValid || !targetValid) throw new Error(`Portal on ${source.key} has invalid source or target.`);
  }
  return maps;
}

export async function compileCurrentContent(options: { realmSlug: string; realmName: string }): Promise<CompiledContentPackage> {
  const prepared = await prepareMaps(); const byKey = new Map(prepared.map((map) => [map.key, map])); const reserved = new Map<string, Set<string>>();
  const npcs: CompiledContentManifest['npcs'] = [];
  for (const definition of CONTENT_NPCS) {
    const map = byKey.get(definition.mapKey); if (!map) throw new Error(`NPC ${definition.key} references missing map ${definition.mapKey}.`);
    const occupied = reserved.get(definition.mapKey) ?? new Set<string>(); reserved.set(definition.mapKey, occupied);
    const position = nearestFreeTile(map, { x: definition.preferredX, y: definition.preferredY }, occupied); occupied.add(`${position.x},${position.y}`);
    npcs.push({ key: definition.key, name: definition.name, mapKey: definition.mapKey, x: position.x, y: position.y, outfitKey: definition.outfitKey, dialogue: definition.dialogue });
  }
  const mobs: CompiledContentManifest['mobs'] = [];
  for (const family of CONTENT_MOBS) {
    const map = byKey.get(family.mapKey); if (!map) throw new Error(`Mob ${family.key} references missing map ${family.mapKey}.`);
    const occupied = reserved.get(family.mapKey) ?? new Set<string>(); reserved.set(family.mapKey, occupied);
    family.spawnPoints.forEach((requested, index) => { const position = nearestFreeTile(map, requested, occupied); occupied.add(`${position.x},${position.y}`); mobs.push({ key: `${family.key}-${index + 1}`, familyKey: family.key, name: family.name, mapKey: family.mapKey, x: position.x, y: position.y, level: family.level, outfitKey: family.outfitKey, respawnMs: family.respawnMs, stats: family.stats, lootTable: family.lootTable }); });
  }
  const manifest: CompiledContentManifest = {
    schemaVersion: CONTENT_SCHEMA_VERSION, version: CURRENT_CONTENT_VERSION,
    realm: { slug: options.realmSlug, name: options.realmName, defaultMapKey: 'greenfields' },
    maps: prepared.map((map) => ({ key: map.key, name: map.name, width: map.tiledMap.width, height: map.tiledMap.height, zoneType: map.zoneType, spawnX: map.spawnX, spawnY: map.spawnY, tiledData: map.tiledMap, portals: [...map.portals].sort((a, b) => `${a.sourceX},${a.sourceY}`.localeCompare(`${b.sourceX},${b.sourceY}`)) })).sort((a, b) => a.key.localeCompare(b.key)),
    items: [...CONTENT_ITEMS].sort((a, b) => a.key.localeCompare(b.key)), npcs: npcs.sort((a, b) => `${a.mapKey}:${a.key}`.localeCompare(`${b.mapKey}:${b.key}`)), mobs: mobs.sort((a, b) => a.key.localeCompare(b.key)),
    skills: SKILL_CATALOG.map((skill) => ({ key: skill.key, name: skill.name, description: skill.description, characterClass: skill.characterClass, minimumLevel: skill.minimumLevel, energyCost: skill.energyCost, cooldownTurns: skill.cooldownTurns, targeting: skill.targeting, maxRank: skill.maxRank, displayOrder: skill.displayOrder, treeRow: skill.treeRow, treeColumn: skill.treeColumn, icon: skill.icon, prerequisiteKeys: [...skill.prerequisiteKeys], effects: [...skill.effects], animationKey: skill.animationKey, visual: { ...skill.visual } })).sort((a, b) => a.key.localeCompare(b.key)),
    quests: [...CONTENT_QUESTS].sort((a, b) => a.key.localeCompare(b.key)), encounters: [...CONTENT_ENCOUNTERS].sort((a, b) => a.key.localeCompare(b.key)), recipes: [...CONTENT_RECIPES].sort((a, b) => a.key.localeCompare(b.key)), expeditions: [...CONTENT_EXPEDITIONS].sort((a, b) => a.key.localeCompare(b.key)),
  };
  validateCompiledManifest(manifest); return { manifest, sourceHash: contentHash(manifest) };
}
function entities(manifest: CompiledContentManifest | null): Map<string, unknown> {
  if (!manifest) return new Map(); const entries: Array<[string, unknown]> = [];
  manifest.maps.forEach((v) => entries.push([`map:${v.key}`, v])); manifest.items.forEach((v) => entries.push([`item:${v.key}`, v])); manifest.npcs.forEach((v) => entries.push([`npc:${v.mapKey}:${v.key}`, v])); manifest.mobs.forEach((v) => entries.push([`mob:${v.mapKey}:${v.key}`, v])); manifest.skills.forEach((v) => entries.push([`skill:${v.key}`, v])); manifest.quests.forEach((v) => entries.push([`quest:${v.key}`, v])); manifest.encounters.forEach((v) => entries.push([`encounter:${v.key}`, v])); manifest.recipes.forEach((v) => entries.push([`recipe:${v.key}`, v])); manifest.expeditions.forEach((v) => entries.push([`expedition:${v.key}`, v])); return new Map(entries);
}
function riskReason(entityKey: string, changeType: ContentChangeType): string | undefined {
  if (changeType === 'REMOVED') return 'definition removed'; if (entityKey.startsWith('map:')) return 'map topology or collision changed'; if (entityKey.startsWith('quest:')) return 'active quest instances keep their stamped definition snapshot'; if (entityKey.startsWith('encounter:') || entityKey.startsWith('expedition:')) return 'active activity instances keep their stamped definition snapshot'; if (entityKey.startsWith('item:')) return 'existing item instances keep their stamped definition snapshot'; return undefined;
}
export function diffContent(previous: CompiledContentManifest | null, next: CompiledContentManifest): ContentDiff {
  validateCompiledManifest(next); const before = entities(previous); const after = entities(next); const entries: ContentDiffEntry[] = [];
  for (const entityKey of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const beforeValue = before.get(entityKey); const afterValue = after.get(entityKey); const beforeHash = beforeValue === undefined ? undefined : contentHash(beforeValue); const afterHash = afterValue === undefined ? undefined : contentHash(afterValue); if (beforeHash === afterHash) continue;
    const changeType: ContentChangeType = beforeValue === undefined ? 'ADDED' : afterValue === undefined ? 'REMOVED' : 'CHANGED'; const reason = riskReason(entityKey, changeType); entries.push({ entityKey, changeType, beforeHash, afterHash, risky: Boolean(reason), riskReason: reason });
  }
  return { added: entries.filter((e) => e.changeType === 'ADDED').map((e) => e.entityKey), changed: entries.filter((e) => e.changeType === 'CHANGED').map((e) => e.entityKey), removed: entries.filter((e) => e.changeType === 'REMOVED').map((e) => e.entityKey), risky: entries.filter((e) => e.risky).map((e) => e.entityKey), entries };
}
