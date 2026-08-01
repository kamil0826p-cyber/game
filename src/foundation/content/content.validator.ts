import type {
  ContentDialogueNode,
  ContentManifest,
  ContentValidationIssue,
} from './content.types.js';

const keys = <T extends { key: string }>(entries: readonly T[]): Set<string> =>
  new Set(entries.map((entry) => entry.key));

const duplicateKeyIssues = <T extends { key: string }>(
  category: string,
  entries: readonly T[],
): ContentValidationIssue[] => {
  const seen = new Set<string>();
  const issues: ContentValidationIssue[] = [];
  for (const entry of entries) {
    if (seen.has(entry.key)) {
      issues.push({
        code: 'DUPLICATE_KEY',
        path: `${category}.${entry.key}`,
        message: `Duplicate ${category} key ${entry.key}.`,
      });
    }
    seen.add(entry.key);
  }
  return issues;
};

const referenceIssue = (path: string, reference: string, target: string): ContentValidationIssue => ({
  code: 'MISSING_REFERENCE',
  path,
  message: `${path} references missing ${target} ${reference}.`,
});

function dialogueIssues(
  npcKey: string,
  rootNodeId: string | undefined,
  nodes: readonly ContentDialogueNode[] | undefined,
  entryNodeIds: readonly string[] | undefined,
  questKeys: ReadonlySet<string>,
  itemKeys: ReadonlySet<string>,
): ContentValidationIssue[] {
  if (!nodes || nodes.length === 0) return [];
  const issues = duplicateKeyIssues(
    `npcs.${npcKey}.nodes`,
    nodes.map((node) => ({ key: node.id })),
  );
  const nodeIds = new Set(nodes.map((node) => node.id));
  if (!rootNodeId || !nodeIds.has(rootNodeId)) {
    issues.push(referenceIssue(`npcs.${npcKey}.rootNodeId`, rootNodeId ?? '<missing>', 'dialogue node'));
    return issues;
  }

  const reachable = new Set<string>();
  const queue = [rootNodeId, ...(entryNodeIds ?? [])];
  for (const entryNodeId of entryNodeIds ?? []) {
    if (!nodeIds.has(entryNodeId)) issues.push(referenceIssue(`npcs.${npcKey}.entryNodeIds`, entryNodeId, 'dialogue node'));
  }
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    const node = nodes.find((candidate) => candidate.id === nodeId);
    if (!node) continue;
    for (const choice of node.choices) {
      for (const target of [choice.nextNodeId, choice.successNodeId, choice.incompleteNodeId]) {
        if (!target) continue;
        if (!nodeIds.has(target)) {
          issues.push(referenceIssue(`npcs.${npcKey}.nodes.${node.id}.choices.${choice.id}`, target, 'dialogue node'));
        } else {
          queue.push(target);
        }
      }
      if (choice.questKey && !questKeys.has(choice.questKey)) {
        issues.push(referenceIssue(`npcs.${npcKey}.nodes.${node.id}.choices.${choice.id}`, choice.questKey, 'quest'));
      }
      if (choice.itemKey && !itemKeys.has(choice.itemKey)) {
        issues.push(referenceIssue(`npcs.${npcKey}.nodes.${node.id}.choices.${choice.id}`, choice.itemKey, 'item'));
      }
    }
  }

  for (const nodeId of nodeIds) {
    if (!reachable.has(nodeId)) {
      issues.push({
        code: 'UNREACHABLE_NODE',
        path: `npcs.${npcKey}.nodes.${nodeId}`,
        message: `Dialogue node ${nodeId} is unreachable from ${rootNodeId}.`,
      });
    }
  }
  return issues;
}

function skillCycleIssues(manifest: ContentManifest): ContentValidationIssue[] {
  const byKey = new Map(manifest.skills.map((skill) => [skill.key, skill]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const issues: ContentValidationIssue[] = [];

  const visit = (key: string, trail: string[]): void => {
    if (visiting.has(key)) {
      const start = trail.indexOf(key);
      const cycle = [...trail.slice(start), key];
      issues.push({
        code: 'CYCLE',
        path: `skills.${key}.prerequisiteKeys`,
        message: `Skill prerequisite cycle detected: ${cycle.join(' -> ')}.`,
      });
      return;
    }
    if (visited.has(key)) return;
    visiting.add(key);
    const skill = byKey.get(key);
    for (const prerequisite of skill?.prerequisiteKeys ?? []) {
      if (byKey.has(prerequisite)) visit(prerequisite, [...trail, key]);
    }
    visiting.delete(key);
    visited.add(key);
  };

  for (const skill of manifest.skills) visit(skill.key, []);
  return issues;
}

function positionCollisionIssues(manifest: ContentManifest): ContentValidationIssue[] {
  const occupied = new Map<string, string>();
  const maps = new Map(manifest.maps.map((map) => [map.key, map]));
  const issues: ContentValidationIssue[] = [];
  const add = (
    mapKey: string,
    x: number | undefined,
    y: number | undefined,
    path: string,
  ): void => {
    if (x === undefined || y === undefined) return;
    const map = maps.get(mapKey);
    const outsideBounds =
      (map?.width !== undefined && x >= map.width) ||
      (map?.height !== undefined && y >= map.height);
    if (x < 0 || y < 0 || !Number.isInteger(x) || !Number.isInteger(y) || outsideBounds) {
      issues.push({
        code: 'INVALID_COORDINATE',
        path,
        message: `${path} has an invalid coordinate ${x},${y} for map ${mapKey}.`,
      });
      return;
    }
    const coordinate = `${mapKey}:${x}:${y}`;
    const existing = occupied.get(coordinate);
    if (existing) {
      issues.push({
        code: 'POSITION_COLLISION',
        path,
        message: `${path} collides with ${existing} at ${mapKey} ${x},${y}.`,
      });
    } else {
      occupied.set(coordinate, path);
    }
  };

  for (const portal of manifest.portals) {
    add(
      portal.sourceMapKey,
      portal.sourceX,
      portal.sourceY,
      `portals.${portal.key}.source`,
    );
    const targetMap = maps.get(portal.destinationMapKey);
    const targetOutsideBounds =
      portal.targetX < 0 ||
      portal.targetY < 0 ||
      !Number.isInteger(portal.targetX) ||
      !Number.isInteger(portal.targetY) ||
      (targetMap?.width !== undefined && portal.targetX >= targetMap.width) ||
      (targetMap?.height !== undefined && portal.targetY >= targetMap.height);
    if (targetOutsideBounds) {
      issues.push({
        code: 'INVALID_COORDINATE',
        path: `portals.${portal.key}.target`,
        message: `Portal ${portal.key} has an invalid target ${portal.targetX},${portal.targetY} for map ${portal.destinationMapKey}.`,
      });
    }
  }
  for (const npc of manifest.npcs) add(npc.mapKey, npc.x, npc.y, `npcs.${npc.key}`);
  for (const mob of manifest.mobs) {
    mob.spawnPoints.forEach((point, index) =>
      add(mob.mapKey, point.x, point.y, `mobs.${mob.key}.spawnPoints.${index}`),
    );
  }
  return issues;
}

export function validateContentManifest(manifest: ContentManifest): ContentValidationIssue[] {
  const issues: ContentValidationIssue[] = [];
  const categories = [
    ['maps', manifest.maps],
    ['portals', manifest.portals],
    ['npcs', manifest.npcs],
    ['quests', manifest.quests],
    ['mobs', manifest.mobs],
    ['encounters', manifest.encounters],
    ['skills', manifest.skills],
    ['items', manifest.items],
    ['lootTables', manifest.lootTables],
    ['recipes', manifest.recipes],
    ['expeditions', manifest.expeditions],
    ['modifiers', manifest.modifiers],
  ] as const;
  for (const [category, entries] of categories) issues.push(...duplicateKeyIssues(category, entries));

  const mapKeys = keys(manifest.maps);
  const npcKeys = keys(manifest.npcs);
  const questKeys = keys(manifest.quests);
  const mobKeys = keys(manifest.mobs);
  const itemKeys = keys(manifest.items);
  const skillKeys = keys(manifest.skills);
  const lootTableKeys = keys(manifest.lootTables);

  for (const portal of manifest.portals) {
    if (!mapKeys.has(portal.sourceMapKey)) issues.push(referenceIssue(`portals.${portal.key}.sourceMapKey`, portal.sourceMapKey, 'map'));
    if (!mapKeys.has(portal.destinationMapKey)) issues.push(referenceIssue(`portals.${portal.key}.destinationMapKey`, portal.destinationMapKey, 'map'));
  }

  for (const npc of manifest.npcs) {
    if (!mapKeys.has(npc.mapKey)) issues.push(referenceIssue(`npcs.${npc.key}.mapKey`, npc.mapKey, 'map'));
    if (npc.questKey && !questKeys.has(npc.questKey)) issues.push(referenceIssue(`npcs.${npc.key}.questKey`, npc.questKey, 'quest'));
    for (const itemKey of npc.merchantItemKeys ?? []) {
      if (!itemKeys.has(itemKey)) issues.push(referenceIssue(`npcs.${npc.key}.merchantItemKeys`, itemKey, 'item'));
    }
    issues.push(...dialogueIssues(npc.key, npc.rootNodeId, npc.nodes, npc.entryNodeIds, questKeys, itemKeys));
  }

  for (const quest of manifest.quests) {
    for (const objective of quest.objectives) {
      if (objective.itemKey && !itemKeys.has(objective.itemKey)) issues.push(referenceIssue(`quests.${quest.key}.objectives.${objective.id}`, objective.itemKey, 'item'));
      if (objective.mobKey && !mobKeys.has(objective.mobKey)) issues.push(referenceIssue(`quests.${quest.key}.objectives.${objective.id}`, objective.mobKey, 'mob'));
      if (objective.npcKey && !npcKeys.has(objective.npcKey)) issues.push(referenceIssue(`quests.${quest.key}.objectives.${objective.id}`, objective.npcKey, 'npc'));
      if (objective.quantity !== undefined && (!Number.isInteger(objective.quantity) || objective.quantity <= 0)) {
        issues.push({ code: 'INVALID_REWARD', path: `quests.${quest.key}.objectives.${objective.id}.quantity`, message: 'Quest objective quantity must be a positive integer.' });
      }
    }
    for (const [currency, amount] of Object.entries({ experience: quest.rewards.experience, silver: quest.rewards.silver, gold: quest.rewards.gold })) {
      if (amount !== undefined && (!Number.isInteger(amount) || amount < 0)) {
        issues.push({ code: 'INVALID_REWARD', path: `quests.${quest.key}.rewards.${currency}`, message: `Quest reward ${currency} must be a non-negative integer.` });
      }
    }
    for (const reward of quest.rewards.items ?? []) {
      if (!itemKeys.has(reward.itemKey)) issues.push(referenceIssue(`quests.${quest.key}.rewards.items`, reward.itemKey, 'item'));
      if (!Number.isInteger(reward.quantity) || reward.quantity <= 0) {
        issues.push({ code: 'INVALID_REWARD', path: `quests.${quest.key}.rewards.items.${reward.itemKey}`, message: 'Quest item reward quantity must be a positive integer.' });
      }
    }
  }

  for (const mob of manifest.mobs) {
    if (!mapKeys.has(mob.mapKey)) issues.push(referenceIssue(`mobs.${mob.key}.mapKey`, mob.mapKey, 'map'));
    if (!lootTableKeys.has(mob.lootTableKey)) issues.push(referenceIssue(`mobs.${mob.key}.lootTableKey`, mob.lootTableKey, 'loot table'));
  }

  for (const encounter of manifest.encounters) {
    for (const mobKey of encounter.mobKeys) {
      if (!mobKeys.has(mobKey)) issues.push(referenceIssue(`encounters.${encounter.key}.mobKeys`, mobKey, 'mob'));
    }
  }

  for (const skill of manifest.skills) {
    for (const prerequisite of skill.prerequisiteKeys) {
      if (!skillKeys.has(prerequisite)) issues.push(referenceIssue(`skills.${skill.key}.prerequisiteKeys`, prerequisite, 'skill'));
    }
  }

  for (const lootTable of manifest.lootTables) {
    for (const entry of lootTable.entries) {
      if (!itemKeys.has(entry.itemKey)) issues.push(referenceIssue(`lootTables.${lootTable.key}.entries`, entry.itemKey, 'item'));
      if (entry.chance < 0 || entry.chance > 1 || entry.minQuantity <= 0 || entry.maxQuantity < entry.minQuantity) {
        issues.push({ code: 'INVALID_LOOT', path: `lootTables.${lootTable.key}.entries.${entry.itemKey}`, message: 'Loot chance must be in [0,1] and quantity bounds must be positive and ordered.' });
      }
    }
  }

  for (const recipe of manifest.recipes) {
    for (const ingredient of recipe.ingredients) {
      if (!itemKeys.has(ingredient.itemKey)) issues.push(referenceIssue(`recipes.${recipe.key}.ingredients`, ingredient.itemKey, 'item'));
      if (!Number.isInteger(ingredient.quantity) || ingredient.quantity <= 0) issues.push({ code: 'INVALID_REWARD', path: `recipes.${recipe.key}.ingredients.${ingredient.itemKey}`, message: 'Recipe ingredient quantity must be a positive integer.' });
    }
    if (!itemKeys.has(recipe.result.itemKey)) issues.push(referenceIssue(`recipes.${recipe.key}.result`, recipe.result.itemKey, 'item'));
    if (!Number.isInteger(recipe.result.quantity) || recipe.result.quantity <= 0) issues.push({ code: 'INVALID_REWARD', path: `recipes.${recipe.key}.result.quantity`, message: 'Recipe result quantity must be a positive integer.' });
  }

  issues.push(...skillCycleIssues(manifest));
  issues.push(...positionCollisionIssues(manifest));
  return issues;
}

export function assertValidContentManifest(manifest: ContentManifest): void {
  const issues = validateContentManifest(manifest);
  if (issues.length === 0) return;
  const details = issues.map((issue) => `${issue.code} ${issue.path}: ${issue.message}`).join('\n');
  throw new Error(`Content manifest validation failed with ${issues.length} issue(s):\n${details}`);
}
