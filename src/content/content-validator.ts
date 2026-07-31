import { createHash } from 'node:crypto';
import { z } from 'zod';

const keySchema = z.string().trim().min(1).max(128);
const uuidSchema = z.string().uuid();
const positiveInteger = z.number().int().positive();
const nonNegativeInteger = z.number().int().nonnegative();

const mapSchema = z.object({
  id: uuidSchema,
  key: keySchema,
  name: z.string().trim().min(1),
  width: positiveInteger,
  height: positiveInteger,
  spawnX: nonNegativeInteger,
  spawnY: nonNegativeInteger,
  tiledData: z.unknown(),
  version: positiveInteger,
});

const portalSchema = z.object({
  id: uuidSchema,
  sourceMapId: uuidSchema,
  sourceX: nonNegativeInteger,
  sourceY: nonNegativeInteger,
  destinationMapId: uuidSchema,
  targetX: nonNegativeInteger,
  targetY: nonNegativeInteger,
});

const itemSchema = z.object({
  id: uuidSchema,
  key: keySchema,
  name: z.string().trim().min(1),
  description: z.string(),
  stackLimit: positiveInteger,
  metadata: z.unknown(),
});

const skillSchema = z.object({
  id: uuidSchema,
  key: keySchema,
  name: z.string().trim().min(1),
  description: z.string(),
  minimumLevel: positiveInteger,
  energyCost: nonNegativeInteger,
  cooldownTurns: nonNegativeInteger,
  maxRank: positiveInteger,
  effectDefinition: z.unknown(),
  visualDefinition: z.unknown(),
});

const skillPrerequisiteSchema = z.object({
  skillDefinitionId: uuidSchema,
  prerequisiteSkillDefinitionId: uuidSchema,
});

const questSchema = z.object({
  id: uuidSchema,
  key: keySchema,
  name: z.string().trim().min(1),
  description: z.string(),
  minimumLevel: positiveInteger,
  steps: z.unknown(),
  rewards: z.unknown(),
});

const npcSchema = z.object({
  id: uuidSchema,
  mapId: uuidSchema,
  key: keySchema,
  name: z.string().trim().min(1),
  x: nonNegativeInteger,
  y: nonNegativeInteger,
  dialogue: z.unknown(),
});

const mobSchema = z.object({
  id: uuidSchema,
  mapId: uuidSchema,
  key: keySchema,
  name: z.string().trim().min(1),
  x: nonNegativeInteger,
  y: nonNegativeInteger,
  level: positiveInteger,
  stats: z.unknown(),
  lootTable: z.unknown(),
  respawnMs: positiveInteger,
});

export const contentSnapshotSchema = z.object({
  maps: z.array(mapSchema),
  portals: z.array(portalSchema),
  items: z.array(itemSchema),
  skills: z.array(skillSchema),
  skillPrerequisites: z.array(skillPrerequisiteSchema),
  quests: z.array(questSchema),
  npcs: z.array(npcSchema),
  mobs: z.array(mobSchema),
});

export type ContentSnapshot = z.infer<typeof contentSnapshotSchema>;

export interface ContentValidationIssue {
  path: string;
  message: string;
}

export interface CompiledContentSnapshot {
  snapshot: ContentSnapshot;
  hash: string;
}

export class ContentValidationError extends Error {
  constructor(readonly issues: readonly ContentValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
    this.name = 'ContentValidationError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

const sortedSnapshot = (snapshot: ContentSnapshot): ContentSnapshot => ({
  maps: [...snapshot.maps].sort((left, right) => left.key.localeCompare(right.key)),
  portals: [...snapshot.portals].sort((left, right) => left.id.localeCompare(right.id)),
  items: [...snapshot.items].sort((left, right) => left.key.localeCompare(right.key)),
  skills: [...snapshot.skills].sort((left, right) => left.key.localeCompare(right.key)),
  skillPrerequisites: [...snapshot.skillPrerequisites].sort((left, right) =>
    `${left.skillDefinitionId}:${left.prerequisiteSkillDefinitionId}`.localeCompare(
      `${right.skillDefinitionId}:${right.prerequisiteSkillDefinitionId}`,
    ),
  ),
  quests: [...snapshot.quests].sort((left, right) => left.key.localeCompare(right.key)),
  npcs: [...snapshot.npcs].sort((left, right) => `${left.mapId}:${left.key}`.localeCompare(`${right.mapId}:${right.key}`)),
  mobs: [...snapshot.mobs].sort((left, right) => `${left.mapId}:${left.key}`.localeCompare(`${right.mapId}:${right.key}`)),
});

const addDuplicateIssues = <T>(
  values: readonly T[],
  getKey: (value: T) => string,
  path: string,
  issues: ContentValidationIssue[],
): void => {
  const seen = new Set<string>();
  for (const value of values) {
    const key = getKey(value);
    if (seen.has(key)) issues.push({ path: `${path}.${key}`, message: 'Duplicate stable key.' });
    seen.add(key);
  }
};

const checkTile = (
  path: string,
  x: number,
  y: number,
  map: ContentSnapshot['maps'][number] | undefined,
  issues: ContentValidationIssue[],
): void => {
  if (!map) {
    issues.push({ path, message: 'References an unknown map.' });
    return;
  }
  if (x >= map.width || y >= map.height) {
    issues.push({ path, message: `Tile ${x},${y} is outside map ${map.key} (${map.width}x${map.height}).` });
  }
};

const collectNamedReferences = (
  value: unknown,
  path: string,
  output: Array<{ kind: 'item' | 'quest' | 'mob' | 'npc' | 'map' | 'skill'; key: string; path: string }>,
): void => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectNamedReferences(entry, `${path}[${index}]`, output));
    return;
  }
  if (!isRecord(value)) return;

  const referenceFields = {
    itemKey: 'item',
    questKey: 'quest',
    mobKey: 'mob',
    npcKey: 'npc',
    mapKey: 'map',
    skillKey: 'skill',
  } as const;

  for (const [field, kind] of Object.entries(referenceFields)) {
    const candidate = value[field];
    if (typeof candidate === 'string' && candidate.trim()) {
      output.push({ kind, key: candidate, path: `${path}.${field}` });
    }
  }

  for (const [field, nested] of Object.entries(value)) {
    collectNamedReferences(nested, `${path}.${field}`, output);
  }
};

const validateDialogueGraph = (
  npc: ContentSnapshot['npcs'][number],
  issues: ContentValidationIssue[],
): void => {
  if (!isRecord(npc.dialogue)) return;
  const rootNodeId = npc.dialogue.rootNodeId;
  const nodes = npc.dialogue.nodes;
  if (rootNodeId === undefined && nodes === undefined) return;
  if (typeof rootNodeId !== 'string' || !isRecord(nodes)) {
    issues.push({ path: `npcs.${npc.key}.dialogue`, message: 'Dialogue requires rootNodeId and a nodes object.' });
    return;
  }
  if (!isRecord(nodes[rootNodeId])) {
    issues.push({ path: `npcs.${npc.key}.dialogue.rootNodeId`, message: `Missing root node ${rootNodeId}.` });
    return;
  }

  const reachable = new Set<string>();
  const queue = [rootNodeId];
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    const node = nodes[nodeId];
    if (!isRecord(node)) continue;
    const choices = node.choices;
    if (!Array.isArray(choices)) continue;
    choices.forEach((choice, index) => {
      if (!isRecord(choice)) return;
      const nextNodeId = choice.nextNodeId;
      if (nextNodeId === undefined) return;
      if (typeof nextNodeId !== 'string' || !isRecord(nodes[nextNodeId])) {
        issues.push({
          path: `npcs.${npc.key}.dialogue.nodes.${nodeId}.choices[${index}].nextNodeId`,
          message: `References missing dialogue node ${String(nextNodeId)}.`,
        });
        return;
      }
      queue.push(nextNodeId);
    });
  }

  for (const nodeId of Object.keys(nodes)) {
    if (!reachable.has(nodeId)) {
      issues.push({ path: `npcs.${npc.key}.dialogue.nodes.${nodeId}`, message: 'Dialogue node is unreachable.' });
    }
  }
};

const validateSkillCycles = (
  snapshot: ContentSnapshot,
  skillsById: ReadonlyMap<string, ContentSnapshot['skills'][number]>,
  issues: ContentValidationIssue[],
): void => {
  const edges = new Map<string, string[]>();
  for (const relation of snapshot.skillPrerequisites) {
    const dependencies = edges.get(relation.skillDefinitionId) ?? [];
    dependencies.push(relation.prerequisiteSkillDefinitionId);
    edges.set(relation.skillDefinitionId, dependencies);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (skillId: string, route: string[]): void => {
    if (visiting.has(skillId)) {
      const skill = skillsById.get(skillId);
      issues.push({
        path: `skills.${skill?.key ?? skillId}.prerequisites`,
        message: `Prerequisite cycle detected: ${[...route, skill?.key ?? skillId].join(' -> ')}.`,
      });
      return;
    }
    if (visited.has(skillId)) return;
    visiting.add(skillId);
    const skill = skillsById.get(skillId);
    for (const dependencyId of edges.get(skillId) ?? []) {
      const dependency = skillsById.get(dependencyId);
      visit(dependencyId, [...route, skill?.key ?? skillId, dependency?.key ?? dependencyId]);
    }
    visiting.delete(skillId);
    visited.add(skillId);
  };

  snapshot.skills.forEach((skill) => visit(skill.id, []));
};

export const compileContentSnapshot = (input: unknown): CompiledContentSnapshot => {
  const parsed = contentSnapshotSchema.safeParse(input);
  if (!parsed.success) {
    throw new ContentValidationError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.length > 0 ? issue.path.join('.') : 'content',
        message: issue.message,
      })),
    );
  }

  const snapshot = sortedSnapshot(parsed.data);
  const issues: ContentValidationIssue[] = [];
  addDuplicateIssues(snapshot.maps, (entry) => entry.key, 'maps', issues);
  addDuplicateIssues(snapshot.items, (entry) => entry.key, 'items', issues);
  addDuplicateIssues(snapshot.skills, (entry) => entry.key, 'skills', issues);
  addDuplicateIssues(snapshot.quests, (entry) => entry.key, 'quests', issues);
  addDuplicateIssues(snapshot.npcs, (entry) => `${entry.mapId}:${entry.key}`, 'npcs', issues);
  addDuplicateIssues(snapshot.mobs, (entry) => `${entry.mapId}:${entry.key}`, 'mobs', issues);

  const mapsById = new Map(snapshot.maps.map((entry) => [entry.id, entry]));
  const mapKeys = new Set(snapshot.maps.map((entry) => entry.key));
  const itemKeys = new Set(snapshot.items.map((entry) => entry.key));
  const questKeys = new Set(snapshot.quests.map((entry) => entry.key));
  const npcKeys = new Set(snapshot.npcs.map((entry) => entry.key));
  const mobKeys = new Set(snapshot.mobs.map((entry) => entry.key));
  const skillKeys = new Set(snapshot.skills.map((entry) => entry.key));
  const skillsById = new Map(snapshot.skills.map((entry) => [entry.id, entry]));

  snapshot.maps.forEach((map) => checkTile(`maps.${map.key}.spawn`, map.spawnX, map.spawnY, map, issues));
  snapshot.portals.forEach((portal) => {
    checkTile(`portals.${portal.id}.source`, portal.sourceX, portal.sourceY, mapsById.get(portal.sourceMapId), issues);
    checkTile(`portals.${portal.id}.target`, portal.targetX, portal.targetY, mapsById.get(portal.destinationMapId), issues);
  });
  snapshot.npcs.forEach((npc) => {
    checkTile(`npcs.${npc.key}.position`, npc.x, npc.y, mapsById.get(npc.mapId), issues);
    validateDialogueGraph(npc, issues);
  });
  snapshot.mobs.forEach((mob) => {
    checkTile(`mobs.${mob.key}.position`, mob.x, mob.y, mapsById.get(mob.mapId), issues);
    if (!Array.isArray(mob.lootTable)) {
      issues.push({ path: `mobs.${mob.key}.lootTable`, message: 'Loot table must be an array.' });
      return;
    }
    mob.lootTable.forEach((entry, index) => {
      if (!isRecord(entry)) {
        issues.push({ path: `mobs.${mob.key}.lootTable[${index}]`, message: 'Loot entry must be an object.' });
        return;
      }
      const chance = entry.chance;
      if (typeof chance !== 'number' || chance < 0 || chance > 1) {
        issues.push({ path: `mobs.${mob.key}.lootTable[${index}].chance`, message: 'Drop chance must be between 0 and 1.' });
      }
      const min = entry.minQuantity;
      const max = entry.maxQuantity;
      if (!Number.isInteger(min) || !Number.isInteger(max) || Number(min) < 1 || Number(max) < Number(min)) {
        issues.push({ path: `mobs.${mob.key}.lootTable[${index}]`, message: 'Loot quantity range is invalid.' });
      }
      if (typeof entry.itemKey !== 'string' || !itemKeys.has(entry.itemKey)) {
        issues.push({ path: `mobs.${mob.key}.lootTable[${index}].itemKey`, message: `Unknown item ${String(entry.itemKey)}.` });
      }
    });
  });

  snapshot.items.forEach((item) => {
    if (!isRecord(item.metadata)) return;
    for (const field of ['buyPriceSilver', 'sellPriceSilver']) {
      const value = item.metadata[field];
      if (value !== undefined && (!Number.isInteger(value) || Number(value) < 0)) {
        issues.push({ path: `items.${item.key}.metadata.${field}`, message: 'Price must be a non-negative integer.' });
      }
    }
  });

  snapshot.skillPrerequisites.forEach((relation, index) => {
    if (!skillsById.has(relation.skillDefinitionId)) {
      issues.push({ path: `skillPrerequisites[${index}].skillDefinitionId`, message: 'Unknown skill.' });
    }
    if (!skillsById.has(relation.prerequisiteSkillDefinitionId)) {
      issues.push({ path: `skillPrerequisites[${index}].prerequisiteSkillDefinitionId`, message: 'Unknown prerequisite skill.' });
    }
    if (relation.skillDefinitionId === relation.prerequisiteSkillDefinitionId) {
      issues.push({ path: `skillPrerequisites[${index}]`, message: 'A skill cannot require itself.' });
    }
  });
  validateSkillCycles(snapshot, skillsById, issues);

  const referenceSets = { item: itemKeys, quest: questKeys, mob: mobKeys, npc: npcKeys, map: mapKeys, skill: skillKeys };
  const references: Array<{ kind: keyof typeof referenceSets; key: string; path: string }> = [];
  snapshot.quests.forEach((quest) => {
    collectNamedReferences(quest.steps, `quests.${quest.key}.steps`, references);
    collectNamedReferences(quest.rewards, `quests.${quest.key}.rewards`, references);
  });
  snapshot.npcs.forEach((npc) => collectNamedReferences(npc.dialogue, `npcs.${npc.key}.dialogue`, references));
  snapshot.skills.forEach((skill) => {
    collectNamedReferences(skill.effectDefinition, `skills.${skill.key}.effectDefinition`, references);
    collectNamedReferences(skill.visualDefinition, `skills.${skill.key}.visualDefinition`, references);
  });
  for (const reference of references) {
    if (!referenceSets[reference.kind].has(reference.key)) {
      issues.push({ path: reference.path, message: `Unknown ${reference.kind} key ${reference.key}.` });
    }
  }

  if (issues.length > 0) throw new ContentValidationError(issues);
  return {
    snapshot,
    hash: createHash('sha256').update(stableJson(snapshot)).digest('hex'),
  };
};
