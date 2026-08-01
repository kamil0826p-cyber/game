import { createHash } from 'node:crypto';
import {
  CONTENT_SECTIONS,
  type CompiledContentPackage,
  type ContentDialogueDefinition,
  type ContentLogicalDiff,
  type ContentSectionName,
  type GameContentManifest,
} from './content.types.js';

export class ContentValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Content validation failed:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    this.name = 'ContentValidationError';
  }
}

type KeyedRecord = { key: string };
type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const looksLikeUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function canonicalValue(value: unknown, propertyName?: string): unknown {
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => canonicalValue(entry));
    if (propertyName?.endsWith('Keys') && normalized.every((entry) => typeof entry === 'string')) {
      return [...normalized].sort((left, right) => String(left).localeCompare(String(right)));
    }
    return normalized;
  }
  if (!isRecord(value)) return value;

  const result: JsonRecord = {};
  for (const key of Object.keys(value).sort()) {
    const entry = value[key];
    if ((key === 'uuid' || key === 'databaseId') && typeof entry === 'string') continue;
    if (key === 'id' && typeof entry === 'string' && looksLikeUuid(entry)) continue;
    result[key] = canonicalValue(entry, key);
  }
  return result;
}

function normalizedManifest(manifest: GameContentManifest): GameContentManifest {
  const result = { ...manifest } as GameContentManifest & Record<ContentSectionName, readonly KeyedRecord[]>;
  for (const section of CONTENT_SECTIONS) {
    result[section] = [...manifest[section]].sort((left, right) => left.key.localeCompare(right.key));
  }
  return result;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function assertUniqueKeys(section: ContentSectionName, records: readonly KeyedRecord[], issues: string[]): void {
  const seen = new Set<string>();
  for (const record of records) {
    if (!record.key.trim()) issues.push(`${section} contains an empty key.`);
    if (seen.has(record.key)) issues.push(`${section} contains duplicate key ${record.key}.`);
    seen.add(record.key);
  }
}

function inBounds(
  map: { width: number; height: number },
  x: number,
  y: number,
): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < map.width && y < map.height;
}

function dialogueEdges(dialogue: ContentDialogueDefinition, nodeId: string): string[] {
  const node = dialogue.nodes[nodeId];
  if (!node) return [];
  const edges: string[] = [];
  for (const choice of node.choices ?? []) {
    if (choice.nextNodeId) edges.push(choice.nextNodeId);
    if (choice.questAction?.successNodeId) edges.push(choice.questAction.successNodeId);
    if (choice.questAction?.incompleteNodeId) edges.push(choice.questAction.incompleteNodeId);
  }
  return edges;
}

function validateDialogue(
  npcKey: string,
  dialogue: ContentDialogueDefinition,
  itemKeys: ReadonlySet<string>,
  questKeys: ReadonlySet<string>,
  issues: string[],
): void {
  const nodeIds = new Set(Object.keys(dialogue.nodes));
  const roots = new Set<string>([dialogue.rootNodeId]);
  for (const root of Object.values(dialogue.quest?.rootNodes ?? {})) roots.add(root);

  for (const root of roots) {
    if (!nodeIds.has(root)) issues.push(`NPC ${npcKey} dialogue references missing root node ${root}.`);
  }
  for (const itemKey of dialogue.merchant?.itemKeys ?? []) {
    if (!itemKeys.has(itemKey)) issues.push(`NPC ${npcKey} merchant references missing item ${itemKey}.`);
  }
  if (dialogue.quest && !questKeys.has(dialogue.quest.questKey)) {
    issues.push(`NPC ${npcKey} references missing quest ${dialogue.quest.questKey}.`);
  }

  for (const nodeId of nodeIds) {
    for (const target of dialogueEdges(dialogue, nodeId)) {
      if (!nodeIds.has(target)) issues.push(`NPC ${npcKey} dialogue node ${nodeId} references missing node ${target}.`);
    }
    for (const choice of dialogue.nodes[nodeId]?.choices ?? []) {
      const questKey = choice.questAction?.questKey;
      if (questKey && !questKeys.has(questKey)) {
        issues.push(`NPC ${npcKey} dialogue choice ${choice.id} references missing quest ${questKey}.`);
      }
    }
  }

  const reachable = new Set<string>();
  const queue = [...roots].filter((root) => nodeIds.has(root));
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const nodeId = queue[cursor]!;
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    for (const target of dialogueEdges(dialogue, nodeId)) if (!reachable.has(target)) queue.push(target);
  }
  for (const nodeId of nodeIds) {
    if (!reachable.has(nodeId)) issues.push(`NPC ${npcKey} dialogue contains unreachable node ${nodeId}.`);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string, path: string[]): void => {
    if (visiting.has(nodeId)) {
      const cycleStart = path.indexOf(nodeId);
      const cycle = [...path.slice(Math.max(0, cycleStart)), nodeId];
      const explicitlyAllowed = cycle.some((entry) => dialogue.nodes[entry]?.allowCycle === true);
      if (!explicitlyAllowed) issues.push(`NPC ${npcKey} dialogue contains cycle ${cycle.join(' -> ')}.`);
      return;
    }
    if (visited.has(nodeId) || !nodeIds.has(nodeId)) return;
    visiting.add(nodeId);
    for (const target of dialogueEdges(dialogue, nodeId)) visit(target, [...path, nodeId]);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const root of roots) visit(root, []);
}

function validateSkillCycles(
  skills: readonly { key: string; prerequisiteKeys: readonly string[] }[],
  issues: string[],
): void {
  const byKey = new Map(skills.map((skill) => [skill.key, skill]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string, path: string[]): void => {
    if (visiting.has(key)) {
      const cycleStart = path.indexOf(key);
      issues.push(`Skill prerequisites contain cycle ${[...path.slice(Math.max(0, cycleStart)), key].join(' -> ')}.`);
      return;
    }
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of byKey.get(key)?.prerequisiteKeys ?? []) visit(dependency, [...path, key]);
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of byKey.keys()) visit(key, []);
}

function nonNegativeInteger(value: unknown): boolean {
  return value === undefined || (Number.isInteger(value) && Number(value) >= 0);
}

export function validateContentManifest(manifest: GameContentManifest): void {
  const issues: string[] = [];
  if (manifest.schemaVersion !== 1) issues.push(`Unsupported content schema version ${String(manifest.schemaVersion)}.`);
  for (const section of CONTENT_SECTIONS) assertUniqueKeys(section, manifest[section], issues);

  const maps = new Map(manifest.maps.map((entry) => [entry.key, entry]));
  const items = new Set(manifest.items.map((entry) => entry.key));
  const quests = new Set(manifest.quests.map((entry) => entry.key));
  const npcs = new Set(manifest.npcs.map((entry) => entry.key));
  const mobs = new Set(manifest.mobs.map((entry) => entry.key));
  const lootTables = new Set(manifest.lootTables.map((entry) => entry.key));
  const encounters = new Set(manifest.encounters.map((entry) => entry.key));
  const modifiers = new Set(manifest.modifiers.map((entry) => entry.key));

  if (!maps.has(manifest.defaultMapKey)) issues.push(`Default map ${manifest.defaultMapKey} does not exist.`);
  for (const map of manifest.maps) {
    if (!Number.isInteger(map.width) || map.width <= 0 || !Number.isInteger(map.height) || map.height <= 0) {
      issues.push(`Map ${map.key} has invalid dimensions.`);
    } else if (!inBounds(map, map.spawnX, map.spawnY)) {
      issues.push(`Map ${map.key} has an out-of-bounds spawn.`);
    }
  }

  const occupiedByMap = new Map<string, Map<string, string>>();
  const occupy = (mapKey: string, x: number, y: number, owner: string): void => {
    const map = maps.get(mapKey);
    if (!map) {
      issues.push(`${owner} references missing map ${mapKey}.`);
      return;
    }
    if (!inBounds(map, x, y)) {
      issues.push(`${owner} is outside map ${mapKey} at ${x},${y}.`);
      return;
    }
    const coordinate = `${x},${y}`;
    const occupied = occupiedByMap.get(mapKey) ?? new Map<string, string>();
    occupiedByMap.set(mapKey, occupied);
    const previous = occupied.get(coordinate);
    if (previous) issues.push(`Coordinate collision on ${mapKey} at ${coordinate}: ${previous} and ${owner}.`);
    else occupied.set(coordinate, owner);
  };
  for (const map of manifest.maps) occupy(map.key, map.spawnX, map.spawnY, `map ${map.key} spawn`);

  for (const portal of manifest.portals) {
    occupy(portal.sourceMapKey, portal.sourceX, portal.sourceY, `portal ${portal.key}`);
    const destination = maps.get(portal.destinationMapKey);
    if (!destination) issues.push(`Portal ${portal.key} references missing destination map ${portal.destinationMapKey}.`);
    else if (!inBounds(destination, portal.targetX, portal.targetY)) {
      issues.push(`Portal ${portal.key} target is outside map ${portal.destinationMapKey}.`);
    }
  }
  for (const npc of manifest.npcs) {
    occupy(npc.mapKey, npc.x, npc.y, `NPC ${npc.key}`);
    validateDialogue(npc.key, npc.dialogue, items, quests, issues);
  }

  for (const lootTable of manifest.lootTables) {
    for (const entry of lootTable.entries) {
      if (!items.has(entry.itemKey)) issues.push(`Loot table ${lootTable.key} references missing item ${entry.itemKey}.`);
      if (!Number.isFinite(entry.chance) || entry.chance < 0 || entry.chance > 1) {
        issues.push(`Loot table ${lootTable.key} has invalid chance for ${entry.itemKey}.`);
      }
      if (!Number.isInteger(entry.minQuantity) || !Number.isInteger(entry.maxQuantity) || entry.minQuantity <= 0 || entry.maxQuantity < entry.minQuantity) {
        issues.push(`Loot table ${lootTable.key} has invalid quantity range for ${entry.itemKey}.`);
      }
    }
  }

  for (const mob of manifest.mobs) {
    occupy(mob.mapKey, mob.x, mob.y, `mob ${mob.key}`);
    if (!lootTables.has(mob.lootTableKey)) issues.push(`Mob ${mob.key} references missing loot table ${mob.lootTableKey}.`);
    if (!Number.isInteger(mob.level) || mob.level <= 0) issues.push(`Mob ${mob.key} has invalid level.`);
    if (!Number.isInteger(mob.respawnMs) || mob.respawnMs < 0) issues.push(`Mob ${mob.key} has invalid respawnMs.`);
  }

  for (const encounter of manifest.encounters) {
    if (!maps.has(encounter.mapKey)) issues.push(`Encounter ${encounter.key} references missing map ${encounter.mapKey}.`);
    if (!Number.isInteger(encounter.minimumPlayers) || encounter.minimumPlayers < 1 || encounter.minimumPlayers > 10) {
      issues.push(`Encounter ${encounter.key} has invalid minimumPlayers.`);
    }
    if (!Number.isInteger(encounter.maximumPlayers) || encounter.maximumPlayers < encounter.minimumPlayers || encounter.maximumPlayers > 10) {
      issues.push(`Encounter ${encounter.key} has invalid maximumPlayers.`);
    }
    let actorCount = 0;
    for (const actor of encounter.actors) {
      if (!mobs.has(actor.mobKey)) issues.push(`Encounter ${encounter.key} references missing mob ${actor.mobKey}.`);
      if (!Number.isInteger(actor.count) || actor.count <= 0) issues.push(`Encounter ${encounter.key} has invalid actor count for ${actor.mobKey}.`);
      actorCount += actor.count;
    }
    if (actorCount < 1 || actorCount > 10) issues.push(`Encounter ${encounter.key} must contain 1-10 actors.`);
    for (const modifierKey of encounter.modifiers ?? []) {
      if (!modifiers.has(modifierKey)) issues.push(`Encounter ${encounter.key} references missing modifier ${modifierKey}.`);
    }
  }

  const skillKeys = new Set(manifest.skills.map((entry) => entry.key));
  for (const skill of manifest.skills) {
    for (const prerequisite of skill.prerequisiteKeys) {
      if (!skillKeys.has(prerequisite)) issues.push(`Skill ${skill.key} references missing prerequisite ${prerequisite}.`);
      if (prerequisite === skill.key) issues.push(`Skill ${skill.key} cannot depend on itself.`);
    }
  }
  validateSkillCycles(manifest.skills, issues);

  for (const quest of manifest.quests) {
    if (!Number.isInteger(quest.minimumLevel) || quest.minimumLevel < 1) issues.push(`Quest ${quest.key} has invalid minimumLevel.`);
    const stepIds = new Set<string>();
    for (const step of quest.steps) {
      if (stepIds.has(step.id)) issues.push(`Quest ${quest.key} contains duplicate step ${step.id}.`);
      stepIds.add(step.id);
      if (step.itemKey && !items.has(step.itemKey)) issues.push(`Quest ${quest.key} references missing item ${step.itemKey}.`);
      if (step.mobKey && !mobs.has(step.mobKey)) issues.push(`Quest ${quest.key} references missing mob ${step.mobKey}.`);
      if (step.npcKey && !npcs.has(step.npcKey)) issues.push(`Quest ${quest.key} references missing NPC ${step.npcKey}.`);
      if (step.quantity !== undefined && (!Number.isInteger(step.quantity) || step.quantity <= 0)) {
        issues.push(`Quest ${quest.key} step ${step.id} has invalid quantity.`);
      }
    }
    if (!nonNegativeInteger(quest.rewards.experience) || !nonNegativeInteger(quest.rewards.silver) || !nonNegativeInteger(quest.rewards.gold)) {
      issues.push(`Quest ${quest.key} contains an illegal negative or fractional reward.`);
    }
    for (const reward of quest.rewards.items ?? []) {
      if (!items.has(reward.itemKey)) issues.push(`Quest ${quest.key} rewards missing item ${reward.itemKey}.`);
      if (!Number.isInteger(reward.quantity) || reward.quantity <= 0) issues.push(`Quest ${quest.key} has invalid item reward quantity.`);
    }
  }

  for (const recipe of manifest.recipes) {
    for (const entry of [...recipe.ingredients, ...recipe.outputs]) {
      if (!items.has(entry.itemKey)) issues.push(`Recipe ${recipe.key} references missing item ${entry.itemKey}.`);
      if (!Number.isInteger(entry.quantity) || entry.quantity <= 0) issues.push(`Recipe ${recipe.key} has invalid quantity for ${entry.itemKey}.`);
    }
    if (recipe.outputs.length === 0) issues.push(`Recipe ${recipe.key} has no outputs.`);
  }

  for (const expedition of manifest.expeditions) {
    for (const encounterKey of expedition.encounterKeys) {
      if (!encounters.has(encounterKey)) issues.push(`Expedition ${expedition.key} references missing encounter ${encounterKey}.`);
    }
    for (const modifierKey of expedition.modifierKeys) {
      if (!modifiers.has(modifierKey)) issues.push(`Expedition ${expedition.key} references missing modifier ${modifierKey}.`);
    }
  }

  if (issues.length > 0) throw new ContentValidationError(issues);
}

export function diffContentManifests(
  previous: GameContentManifest | undefined,
  next: GameContentManifest,
): ContentLogicalDiff {
  const result = {} as ContentLogicalDiff;
  for (const section of CONTENT_SECTIONS) {
    const before = new Map((previous?.[section] ?? []).map((record) => [record.key, stableStringify(record)]));
    const after = new Map(next[section].map((record) => [record.key, stableStringify(record)]));
    result[section] = {
      added: [...after.keys()].filter((key) => !before.has(key)).sort(),
      removed: [...before.keys()].filter((key) => !after.has(key)).sort(),
      changed: [...after.keys()].filter((key) => before.has(key) && before.get(key) !== after.get(key)).sort(),
    };
  }
  return result;
}

export function compileContentManifest(
  manifest: GameContentManifest,
  previous?: GameContentManifest,
): CompiledContentPackage {
  validateContentManifest(manifest);
  const normalized = normalizedManifest(manifest);
  const canonicalJson = stableStringify(normalized);
  const hash = createHash('sha256').update(canonicalJson).digest('hex');
  return {
    hash,
    canonicalJson,
    manifest: normalized,
    logicalDiff: diffContentManifests(previous, normalized),
  };
}
