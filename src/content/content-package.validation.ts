import { CONTENT_SCHEMA_VERSION } from './current-content.js';
import { isRecord, type CompiledContentManifest } from './content-package.types.js';

function unique(kind: string, keys: readonly string[]): void {
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  if (duplicates.length) throw new Error(`${kind} keys must be unique: ${[...new Set(duplicates)].join(', ')}.`);
}
function key(kind: string, value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${kind} key cannot be empty.`);
}
function refs(node: Record<string, unknown>): string[] {
  const result: string[] = [];
  if (typeof node.nextNodeId === 'string') result.push(node.nextNodeId);
  for (const rawChoice of Array.isArray(node.choices) ? node.choices : []) {
    if (!isRecord(rawChoice)) continue;
    for (const field of ['nextNodeId', 'successNodeId', 'incompleteNodeId']) if (typeof rawChoice[field] === 'string') result.push(rawChoice[field] as string);
    if (isRecord(rawChoice.questAction)) for (const field of ['successNodeId', 'incompleteNodeId']) if (typeof rawChoice.questAction[field] === 'string') result.push(rawChoice.questAction[field] as string);
  }
  return result;
}
function validateDialogue(npcKey: string, dialogue: Record<string, unknown>, quests: Set<string>, items: Set<string>): void {
  if (typeof dialogue.rootNodeId !== 'string' || !isRecord(dialogue.nodes) || !isRecord(dialogue.nodes[dialogue.rootNodeId])) throw new Error(`NPC ${npcKey} has an invalid dialogue root.`);
  const nodes = dialogue.nodes;
  for (const [nodeKey, raw] of Object.entries(nodes)) {
    if (!isRecord(raw)) throw new Error(`NPC ${npcKey} dialogue node ${nodeKey} is malformed.`);
    const choiceIds = (Array.isArray(raw.choices) ? raw.choices : []).flatMap((choice) => isRecord(choice) && typeof choice.id === 'string' ? [choice.id] : []);
    unique(`NPC ${npcKey} dialogue choice in ${nodeKey}`, choiceIds);
    for (const reference of refs(raw)) if (!isRecord(nodes[reference])) throw new Error(`NPC ${npcKey} dialogue node ${nodeKey} references missing node ${reference}.`);
  }
  const reachable = new Set<string>();
  const queue = [dialogue.rootNodeId];
  if (isRecord(dialogue.quest) && isRecord(dialogue.quest.rootNodes)) {
    for (const root of Object.values(dialogue.quest.rootNodes)) if (typeof root === 'string') queue.push(root);
    if (typeof dialogue.quest.questKey !== 'string' || !quests.has(dialogue.quest.questKey)) throw new Error(`NPC ${npcKey} references missing quest ${String(dialogue.quest.questKey)}.`);
  }
  while (queue.length) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    const node = nodes[current];
    if (isRecord(node)) queue.push(...refs(node));
  }
  const unreachable = Object.keys(nodes).filter((nodeKey) => !reachable.has(nodeKey));
  if (unreachable.length) throw new Error(`NPC ${npcKey} has unreachable dialogue nodes: ${unreachable.join(', ')}.`);
  if (isRecord(dialogue.merchant)) for (const itemKey of Array.isArray(dialogue.merchant.itemKeys) ? dialogue.merchant.itemKeys : []) if (typeof itemKey !== 'string' || !items.has(itemKey)) throw new Error(`NPC ${npcKey} references missing merchant item ${String(itemKey)}.`);
}
function validateSkills(manifest: CompiledContentManifest): void {
  const byKey = new Map(manifest.skills.map((skill) => [skill.key, skill]));
  const visiting = new Set<string>(); const visited = new Set<string>();
  const visit = (skillKey: string): void => {
    if (visiting.has(skillKey)) throw new Error(`Skill prerequisite cycle contains ${skillKey}.`);
    if (visited.has(skillKey)) return;
    visiting.add(skillKey);
    for (const dependency of byKey.get(skillKey)?.prerequisiteKeys ?? []) {
      if (!byKey.has(dependency)) throw new Error(`Skill ${skillKey} references missing prerequisite ${dependency}.`);
      if (dependency === skillKey) throw new Error(`Skill ${skillKey} cannot require itself.`);
      visit(dependency);
    }
    visiting.delete(skillKey); visited.add(skillKey);
  };
  for (const skillKey of byKey.keys()) visit(skillKey);
}

export function validateCompiledManifest(manifest: CompiledContentManifest): void {
  if (manifest.schemaVersion !== CONTENT_SCHEMA_VERSION) throw new Error(`Unsupported content schema ${manifest.schemaVersion}. Runtime supports ${CONTENT_SCHEMA_VERSION}.`);
  key('Content version', manifest.version);
  const maps = new Set(manifest.maps.map((value) => value.key));
  const items = new Set(manifest.items.map((value) => value.key));
  const quests = new Set(manifest.quests.map((value) => value.key));
  const mobFamilies = new Set(manifest.mobs.map((value) => value.familyKey));
  const encounters = new Set(manifest.encounters.map((value) => value.key));
  unique('Map', [...maps]); unique('Item', [...items]); unique('Quest', [...quests]);
  unique('NPC', manifest.npcs.map((value) => `${value.mapKey}:${value.key}`));
  unique('Mob', manifest.mobs.map((value) => `${value.mapKey}:${value.key}`));
  unique('Skill', manifest.skills.map((value) => value.key)); unique('Encounter', [...encounters]);
  unique('Recipe', manifest.recipes.map((value) => value.key)); unique('Expedition', manifest.expeditions.map((value) => value.key));
  if (!maps.has(manifest.realm.defaultMapKey)) throw new Error(`Default map ${manifest.realm.defaultMapKey} is missing.`);
  for (const map of manifest.maps) {
    if (map.width < 1 || map.height < 1 || map.spawnX < 0 || map.spawnY < 0 || map.spawnX >= map.width || map.spawnY >= map.height) throw new Error(`Map ${map.key} has invalid dimensions or spawn.`);
    for (const portal of map.portals) if (!maps.has(portal.destinationMapKey)) throw new Error(`Portal on ${map.key} references missing map ${portal.destinationMapKey}.`);
  }
  for (const item of manifest.items) {
    key('Item', item.key);
    if (!Number.isInteger(item.stackLimit) || item.stackLimit < 1) throw new Error(`Item ${item.key} has invalid stack limit.`);
    const buy = item.metadata.buyPriceSilver; const sell = item.metadata.sellPriceSilver;
    if (!Number.isInteger(buy) || !Number.isInteger(sell) || Number(buy) < 0 || Number(sell) < 0) throw new Error(`Item ${item.key} has invalid prices.`);
    if (Number(buy) > 0 && Number(sell) > Number(buy)) throw new Error(`Item ${item.key} creates an infinite merchant arbitrage.`);
  }
  for (const quest of manifest.quests) {
    if (!Number.isInteger(quest.minimumLevel) || quest.minimumLevel < 1 || !quest.steps.length) throw new Error(`Quest ${quest.key} is invalid.`);
    for (const step of quest.steps) {
      if (typeof step.itemKey === 'string' && !items.has(step.itemKey)) throw new Error(`Quest ${quest.key} references missing item ${step.itemKey}.`);
      if (step.quantity !== undefined && (!Number.isInteger(step.quantity) || Number(step.quantity) < 1)) throw new Error(`Quest ${quest.key} has invalid quantity.`);
    }
    for (const [reward, amount] of Object.entries(quest.rewards)) if (!Number.isInteger(amount) || amount < 0) throw new Error(`Quest ${quest.key} has illegal ${reward} reward.`);
  }
  for (const npc of manifest.npcs) {
    if (!maps.has(npc.mapKey)) throw new Error(`NPC ${npc.key} references missing map ${npc.mapKey}.`);
    validateDialogue(npc.key, npc.dialogue, quests, items);
  }
  for (const mob of manifest.mobs) {
    if (!maps.has(mob.mapKey)) throw new Error(`Mob ${mob.key} references missing map ${mob.mapKey}.`);
    if (!Number.isInteger(mob.level) || mob.level < 1 || !Number.isInteger(mob.respawnMs) || mob.respawnMs < 1) throw new Error(`Mob ${mob.key} has invalid level or respawn.`);
    for (const loot of mob.lootTable) {
      if (!items.has(loot.itemKey)) throw new Error(`Mob ${mob.key} references missing item ${loot.itemKey}.`);
      if (loot.chance < 0 || loot.chance > 1 || loot.minQuantity < 1 || loot.maxQuantity < loot.minQuantity) throw new Error(`Mob ${mob.key} has invalid loot ${loot.itemKey}.`);
    }
  }
  for (const encounter of manifest.encounters) {
    if (!maps.has(encounter.mapKey)) throw new Error(`Encounter ${encounter.key} references missing map ${encounter.mapKey}.`);
    for (const family of encounter.mobFamilyKeys) if (!mobFamilies.has(family)) throw new Error(`Encounter ${encounter.key} references missing mob family ${family}.`);
    for (const itemKey of encounter.rewardItemKeys) if (!items.has(itemKey)) throw new Error(`Encounter ${encounter.key} references missing reward ${itemKey}.`);
  }
  for (const recipe of manifest.recipes) {
    if (!items.has(recipe.resultItemKey)) throw new Error(`Recipe ${recipe.key} references missing result ${recipe.resultItemKey}.`);
    for (const itemKey of recipe.ingredientItemKeys) if (!items.has(itemKey)) throw new Error(`Recipe ${recipe.key} references missing ingredient ${itemKey}.`);
  }
  for (const expedition of manifest.expeditions) {
    if (!Number.isInteger(expedition.minimumPartySize) || !Number.isInteger(expedition.maximumPartySize) || expedition.minimumPartySize < 1 || expedition.maximumPartySize > 10 || expedition.minimumPartySize > expedition.maximumPartySize) throw new Error(`Expedition ${expedition.key} has invalid party limits.`);
    for (const encounterKey of expedition.encounterKeys) if (!encounters.has(encounterKey)) throw new Error(`Expedition ${expedition.key} references missing encounter ${encounterKey}.`);
  }
  validateSkills(manifest);
}
