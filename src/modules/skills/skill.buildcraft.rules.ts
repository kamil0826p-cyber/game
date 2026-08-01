import { createHash } from 'node:crypto';
import type { CharacterClass } from '../../common/domain/game.types.js';
import { SKILL_CATALOG } from './skill.catalog.js';
import {
  findSkillBuildNode,
  skillBuildNodesForClass,
  skillSpecializationsForClass,
  SKILL_BUILD_CATALOG,
} from './skill.buildcraft.catalog.js';
import {
  SKILL_BUILD_MAX_ACTIVE_ACTIONS,
  SKILL_BUILD_MAX_LOADOUTS,
  SKILL_BUILD_MAX_PASSIVE_SLOTS,
  SKILL_BUILD_PASSIVE_BUDGET,
  SKILL_BUILD_RULES_VERSION,
  type SkillBuildCatalog,
  type SkillBuildNodeDefinition,
  type SkillBuildPersistenceData,
  type SkillFallbackAction,
  type SkillLoadoutDefinition,
  type SkillLoadoutInvalidReason,
  type SkillModifierOperation,
} from './skill.buildcraft.types.js';
import type {
  CombatEffectOperation,
  SkillCatalogDefinition,
  SkillPointSummary,
} from './skill.types.js';

export const SKILL_BUILD_POINT_LEVEL_INTERVAL = 5;
export const SKILL_BUILD_ACTIVE_RANK_MULTIPLIER = 0.12;

export interface LearnedSkillState {
  skillKey: string;
  rank: number;
  cooldownTurnsRemaining: number;
}

export interface BuildValidationResult {
  valid: boolean;
  reasons: string[];
}

export interface CatalogValidationResult {
  valid: boolean;
  errors: string[];
}

export const calculateBuildPoints = (level: number, spent: number): SkillPointSummary => {
  const safeLevel = Math.max(1, Math.trunc(level));
  const safeSpent = Math.max(0, Math.trunc(spent));
  const earned = Math.floor(safeLevel / SKILL_BUILD_POINT_LEVEL_INTERVAL);
  const nextPointAtLevel =
    (Math.floor(safeLevel / SKILL_BUILD_POINT_LEVEL_INTERVAL) + 1) *
    SKILL_BUILD_POINT_LEVEL_INTERVAL;
  return {
    earned,
    spent: safeSpent,
    available: Math.max(0, earned - safeSpent),
    nextPointAtLevel,
  };
};

export const buildPointsGainedBetweenLevels = (
  previousLevel: number,
  nextLevel: number,
): number =>
  Math.max(
    0,
    calculateBuildPoints(nextLevel, 0).earned - calculateBuildPoints(previousLevel, 0).earned,
  );

export const rankMapFromLearned = (
  learned: readonly LearnedSkillState[],
  virtualRanks: Readonly<Record<string, number>>,
): Record<string, number> => ({
  ...virtualRanks,
  ...Object.fromEntries(learned.map((entry) => [entry.skillKey, Math.max(0, entry.rank)])),
});

export const spentBuildPoints = (
  characterClass: CharacterClass,
  ranks: Readonly<Record<string, number>>,
): number =>
  skillBuildNodesForClass(characterClass).reduce((sum, node) => {
    const rank = Math.max(0, Math.trunc(ranks[node.key] ?? 0));
    return sum + rank * node.pointCost;
  }, 0);

export const passiveBudgetSpent = (
  passiveKeys: readonly string[],
  ranks: Readonly<Record<string, number>>,
): number =>
  passiveKeys.reduce((sum, key) => {
    const node = findSkillBuildNode(key);
    return sum + (node?.passiveCost ?? 0) * Math.max(0, ranks[key] ?? 0);
  }, 0);

const rankOf = (ranks: Readonly<Record<string, number>>, key: string): number =>
  Math.max(0, Math.trunc(ranks[key] ?? 0));

export const validateRankUp = (input: {
  characterClass: CharacterClass;
  characterLevel: number;
  selectedSpecializationKey?: string;
  ranks: Readonly<Record<string, number>>;
  nodeKey: string;
}): BuildValidationResult => {
  const node = findSkillBuildNode(input.nodeKey);
  const reasons: string[] = [];
  if (!node || node.characterClass !== input.characterClass) {
    return { valid: false, reasons: ['UNKNOWN_NODE'] };
  }
  const currentRank = rankOf(input.ranks, node.key);
  if (currentRank >= node.maxRank) reasons.push('MAX_RANK');
  if (input.characterLevel < node.minimumLevel) reasons.push('LEVEL_REQUIRED');
  if (
    node.specializationKey &&
    node.specializationKey !== input.selectedSpecializationKey
  ) {
    reasons.push('SPECIALIZATION_REQUIRED');
  }
  const missing = node.prerequisiteKeys.filter((key) => rankOf(input.ranks, key) < 1);
  if (missing.length > 0) reasons.push(`PREREQUISITE:${missing.join(',')}`);
  for (const alternatives of node.prerequisiteAnyOf ?? []) {
    if (!alternatives.some((key) => rankOf(input.ranks, key) > 0)) {
      reasons.push(`PREREQUISITE_ANY:${alternatives.join(',')}`);
    }
  }
  if (node.choiceGroupKey) {
    const conflicting = skillBuildNodesForClass(input.characterClass).find(
      (candidate) =>
        candidate.key !== node.key &&
        candidate.choiceGroupKey === node.choiceGroupKey &&
        rankOf(input.ranks, candidate.key) > 0,
    );
    if (conflicting) reasons.push(`CHOICE_CONFLICT:${conflicting.key}`);
  }
  const spent = spentBuildPoints(input.characterClass, input.ranks);
  const points = calculateBuildPoints(input.characterLevel, spent);
  if (points.available < node.pointCost) reasons.push('POINTS_REQUIRED');
  return { valid: reasons.length === 0, reasons };
};

export const validateSpecializationSelection = (input: {
  characterClass: CharacterClass;
  specializationKey: string;
  ranks: Readonly<Record<string, number>>;
}): BuildValidationResult => {
  const specialization = skillSpecializationsForClass(input.characterClass).find(
    (candidate) => candidate.key === input.specializationKey,
  );
  if (!specialization) return { valid: false, reasons: ['UNKNOWN_SPECIALIZATION'] };
  const conflicting = skillBuildNodesForClass(input.characterClass).filter(
    (node) =>
      node.specializationKey &&
      node.specializationKey !== specialization.key &&
      rankOf(input.ranks, node.key) > 0,
  );
  return conflicting.length === 0
    ? { valid: true, reasons: [] }
    : {
        valid: false,
        reasons: conflicting.map((node) => `SPENT_IN_OTHER_SPECIALIZATION:${node.key}`),
      };
};

export const validateLoadout = (input: {
  characterClass: CharacterClass;
  selectedSpecializationKey?: string;
  ranks: Readonly<Record<string, number>>;
  activeSkillKeys: readonly string[];
  passiveNodeKeys: readonly string[];
}): SkillLoadoutInvalidReason[] => {
  const reasons = new Set<SkillLoadoutInvalidReason>();
  if (input.activeSkillKeys.length > SKILL_BUILD_MAX_ACTIVE_ACTIONS) {
    reasons.add('TOO_MANY_ACTIVE_ACTIONS');
  }
  if (input.passiveNodeKeys.length > SKILL_BUILD_MAX_PASSIVE_SLOTS) {
    reasons.add('TOO_MANY_PASSIVES');
  }
  if (new Set(input.activeSkillKeys).size !== input.activeSkillKeys.length) {
    reasons.add('DUPLICATE_ENTRY');
  }
  if (new Set(input.passiveNodeKeys).size !== input.passiveNodeKeys.length) {
    reasons.add('DUPLICATE_ENTRY');
  }
  for (const key of input.activeSkillKeys) {
    const node = findSkillBuildNode(key);
    if (!node || node.characterClass !== input.characterClass || node.kind !== 'ACTIVE') {
      reasons.add('UNKNOWN_SKILL');
      continue;
    }
    if (rankOf(input.ranks, key) < 1) reasons.add('SKILL_NOT_LEARNED');
  }
  for (const key of input.passiveNodeKeys) {
    const node = findSkillBuildNode(key);
    if (
      !node ||
      node.characterClass !== input.characterClass ||
      !['PASSIVE', 'MODIFIER', 'KEYSTONE'].includes(node.kind)
    ) {
      reasons.add('UNKNOWN_PASSIVE');
      continue;
    }
    if (rankOf(input.ranks, key) < 1) reasons.add('PASSIVE_NOT_LEARNED');
    if (
      node.specializationKey &&
      node.specializationKey !== input.selectedSpecializationKey
    ) {
      reasons.add('SPECIALIZATION_MISMATCH');
    }
  }
  if (passiveBudgetSpent(input.passiveNodeKeys, input.ranks) > SKILL_BUILD_PASSIVE_BUDGET) {
    reasons.add('PASSIVE_BUDGET_EXCEEDED');
  }
  return [...reasons];
};

export const revalidateLoadouts = (input: {
  characterClass: CharacterClass;
  selectedSpecializationKey?: string;
  ranks: Readonly<Record<string, number>>;
  loadouts: readonly SkillLoadoutDefinition[];
}): SkillLoadoutDefinition[] =>
  input.loadouts.map((loadout) => {
    const invalidReasons = validateLoadout({
      characterClass: input.characterClass,
      selectedSpecializationKey: input.selectedSpecializationKey,
      ranks: input.ranks,
      activeSkillKeys: loadout.activeSkillKeys,
      passiveNodeKeys: loadout.passiveNodeKeys,
    });
    return { ...loadout, isValid: invalidReasons.length === 0, invalidReasons };
  });

const scaleEffect = (
  effect: CombatEffectOperation,
  multiplier: number,
): CombatEffectOperation => {
  switch (effect.type) {
    case 'DAMAGE':
      return {
        ...effect,
        coefficient: Number((effect.coefficient * multiplier).toFixed(4)),
        bonusCoefficient:
          effect.bonusCoefficient === undefined
            ? undefined
            : Number((effect.bonusCoefficient * multiplier).toFixed(4)),
      };
    case 'HEAL':
    case 'SHIELD':
      return {
        ...effect,
        coefficient: Number((effect.coefficient * multiplier).toFixed(4)),
      };
    case 'APPLY_STATUS':
      return {
        ...effect,
        magnitude:
          effect.magnitude === undefined
            ? undefined
            : Number((effect.magnitude * multiplier).toFixed(4)),
      };
    default:
      return { ...effect };
  }
};

const applyModifier = (
  definition: SkillCatalogDefinition,
  operation: SkillModifierOperation,
): SkillCatalogDefinition => {
  switch (operation.type) {
    case 'SET_TARGETING':
      return {
        ...definition,
        targeting: operation.targeting,
        effects:
          operation.coefficientMultiplier === undefined
            ? definition.effects
            : definition.effects.map((effect) =>
                effect.type === 'DAMAGE'
                  ? scaleEffect(effect, operation.coefficientMultiplier!)
                  : effect,
              ),
      };
    case 'ADJUST_ENERGY_COST':
      return {
        ...definition,
        energyCost: Math.max(operation.minimum, definition.energyCost + operation.flatDelta),
      };
    case 'ADJUST_COOLDOWN':
      return {
        ...definition,
        cooldownTurns: Math.max(
          operation.minimum,
          definition.cooldownTurns + operation.flatDelta,
        ),
      };
    case 'SCALE_EFFECT':
      return {
        ...definition,
        effects: definition.effects.map((effect) =>
          effect.type === operation.effectType
            ? scaleEffect(effect, operation.multiplier)
            : effect,
        ),
      };
    case 'ADD_STATUS_EFFECT':
      return {
        ...definition,
        effects: [
          ...definition.effects,
          {
            type: 'APPLY_STATUS',
            statusKey: operation.statusKey,
            durationTurns: operation.durationTurns,
            magnitude: operation.magnitude,
            chance: operation.chance,
          },
        ],
      };
    case 'CONSUME_STATUS': {
      let applied = false;
      return {
        ...definition,
        effects: definition.effects.map((effect) => {
          if (applied || effect.type !== 'DAMAGE') return effect;
          applied = true;
          return { ...effect, consumesStatus: operation.statusKey };
        }),
      };
    }
  }
};

export const resolveSkillDefinition = (input: {
  skillKey: string;
  activeRank: number;
  passiveNodeKeys: readonly string[];
  ranks: Readonly<Record<string, number>>;
}): SkillCatalogDefinition | undefined => {
  const base = SKILL_CATALOG.find((skill) => skill.key === input.skillKey);
  if (!base || input.activeRank < 1) return undefined;
  const rankMultiplier =
    1 + Math.max(0, input.activeRank - 1) * SKILL_BUILD_ACTIVE_RANK_MULTIPLIER;
  let resolved: SkillCatalogDefinition = {
    ...base,
    maxRank: Math.max(1, findSkillBuildNode(base.key)?.maxRank ?? base.maxRank) as 1,
    effects: base.effects.map((effect) => scaleEffect(effect, rankMultiplier)),
    visual: { ...base.visual },
    prerequisiteKeys: [...base.prerequisiteKeys],
  };
  for (const nodeKey of input.passiveNodeKeys) {
    const node = findSkillBuildNode(nodeKey);
    if (!node || node.modifiesSkillKey !== base.key) continue;
    const rank = Math.min(rankOf(input.ranks, node.key), node.maxRank);
    for (let index = 0; index < rank; index += 1) {
      for (const operation of node.modifiersByRank?.[index] ?? []) {
        resolved = applyModifier(resolved, operation);
      }
    }
  }
  return resolved;
};

export const createInitialBuildData = (
  learned: readonly LearnedSkillState[],
  now: string,
  fallbackAction: SkillFallbackAction = 'DEFEND',
): SkillBuildPersistenceData => {
  const activeSkillKeys = learned.slice(0, SKILL_BUILD_MAX_ACTIVE_ACTIONS).map((entry) => entry.skillKey);
  const defaultLoadout: SkillLoadoutDefinition = {
    id: 'default',
    name: 'Default',
    activeSkillKeys,
    passiveNodeKeys: [],
    fallbackAction,
    version: 1,
    isValid: true,
    invalidReasons: [],
    updatedAt: now,
  };
  return {
    rulesVersion: SKILL_BUILD_RULES_VERSION,
    nodeRanks: {},
    loadouts: [defaultLoadout],
    activeLoadoutId: defaultLoadout.id,
    freeRespecAvailable: true,
    migration: {
      migratedAt: now,
      backup: learned.map((entry) => ({
        skillKey: entry.skillKey,
        rank: entry.rank,
        cooldownTurnsRemaining: entry.cooldownTurnsRemaining,
      })),
    },
    operations: {},
    audit: [
      {
        at: now,
        action: 'MIGRATE',
        beforeVersion: 0,
        afterVersion: 1,
        metadata: {
          learnedSkillCount: learned.length,
          defaultLoadoutSkillCount: activeSkillKeys.length,
        },
      },
    ],
  };
};

export const normalizeBuildData = (
  value: unknown,
  learned: readonly LearnedSkillState[],
  now: string,
): SkillBuildPersistenceData => {
  if (!value || typeof value !== 'object') return createInitialBuildData(learned, now);
  const candidate = value as Partial<SkillBuildPersistenceData>;
  return {
    rulesVersion: SKILL_BUILD_RULES_VERSION,
    selectedSpecializationKey:
      typeof candidate.selectedSpecializationKey === 'string'
        ? candidate.selectedSpecializationKey
        : undefined,
    nodeRanks:
      candidate.nodeRanks && typeof candidate.nodeRanks === 'object'
        ? Object.fromEntries(
            Object.entries(candidate.nodeRanks).flatMap(([key, rank]) =>
              Number.isInteger(rank) && Number(rank) > 0 ? [[key, Number(rank)]] : [],
            ),
          )
        : {},
    loadouts: Array.isArray(candidate.loadouts)
      ? candidate.loadouts.slice(0, SKILL_BUILD_MAX_LOADOUTS).map((loadout, index) => ({
          id: typeof loadout.id === 'string' ? loadout.id : `recovered-${index + 1}`,
          name: typeof loadout.name === 'string' ? loadout.name.slice(0, 32) : `Loadout ${index + 1}`,
          activeSkillKeys: Array.isArray(loadout.activeSkillKeys)
            ? loadout.activeSkillKeys.filter((key): key is string => typeof key === 'string')
            : [],
          passiveNodeKeys: Array.isArray(loadout.passiveNodeKeys)
            ? loadout.passiveNodeKeys.filter((key): key is string => typeof key === 'string')
            : [],
          fallbackAction: ['DEFEND', 'BASIC_ATTACK', 'SKIP'].includes(loadout.fallbackAction)
            ? (loadout.fallbackAction as SkillFallbackAction)
            : 'DEFEND',
          version: Number.isInteger(loadout.version) ? Math.max(1, loadout.version) : 1,
          isValid: loadout.isValid !== false,
          invalidReasons: Array.isArray(loadout.invalidReasons)
            ? loadout.invalidReasons
            : [],
          updatedAt: typeof loadout.updatedAt === 'string' ? loadout.updatedAt : now,
        }))
      : createInitialBuildData(learned, now).loadouts,
    activeLoadoutId:
      typeof candidate.activeLoadoutId === 'string' ? candidate.activeLoadoutId : 'default',
    freeRespecAvailable: candidate.freeRespecAvailable !== false,
    migration:
      candidate.migration && Array.isArray(candidate.migration.backup)
        ? candidate.migration
        : createInitialBuildData(learned, now).migration,
    operations:
      candidate.operations && typeof candidate.operations === 'object'
        ? candidate.operations
        : {},
    audit: Array.isArray(candidate.audit) ? candidate.audit.slice(-100) : [],
  };
};

export const skillRespecCostSilver = (
  level: number,
  spentPoints: number,
  freeRespecAvailable: boolean,
): number =>
  freeRespecAvailable
    ? 0
    : Math.max(100, Math.trunc(level) * 25 + Math.max(0, spentPoints) * 40);

export const payloadHash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const validateBuildCatalog = (
  catalog: SkillBuildCatalog = SKILL_BUILD_CATALOG,
): CatalogValidationResult => {
  const errors: string[] = [];
  const nodeByKey = new Map<string, SkillBuildNodeDefinition>();
  const specializationKeys = new Set<string>();
  for (const specialization of catalog.specializations) {
    if (specializationKeys.has(specialization.key)) {
      errors.push(`duplicate specialization: ${specialization.key}`);
    }
    specializationKeys.add(specialization.key);
    if (specialization.groupSynergies.length < 2) {
      errors.push(`specialization requires two group synergies: ${specialization.key}`);
    }
    if (!specialization.soloLoop || !specialization.threatResponse || !specialization.drawback) {
      errors.push(`incomplete specialization promise: ${specialization.key}`);
    }
  }
  for (const node of catalog.nodes) {
    if (nodeByKey.has(node.key)) errors.push(`duplicate node: ${node.key}`);
    nodeByKey.set(node.key, node);
    if (node.maxRank < 1 || node.pointCost < 1) errors.push(`invalid rank cost: ${node.key}`);
    if (node.specializationKey && !specializationKeys.has(node.specializationKey)) {
      errors.push(`unknown specialization: ${node.key}`);
    }
    const modifiedSkill = node.modifiesSkillKey
      ? SKILL_CATALOG.find((skill) => skill.key === node.modifiesSkillKey)
      : undefined;
    if (node.modifiesSkillKey && !modifiedSkill) {
      errors.push(`unknown modified skill: ${node.key}`);
    }
    if (modifiedSkill && modifiedSkill.characterClass !== node.characterClass) {
      errors.push(`cross-class modified skill: ${node.key}`);
    }
    if (node.modifiersByRank && !node.modifiesSkillKey) {
      errors.push(`modifier target missing: ${node.key}`);
    }
    if (node.modifiersByRank && node.modifiersByRank.length !== node.maxRank) {
      errors.push(`modifier rank mismatch: ${node.key}`);
    }
    for (const operation of node.modifiersByRank?.flat() ?? []) {
      if (operation.version !== 1) {
        errors.push(`unsupported modifier version: ${node.key}`);
        continue;
      }
      switch (operation.type) {
        case 'SET_TARGETING':
          if (
            operation.coefficientMultiplier !== undefined &&
            (!Number.isFinite(operation.coefficientMultiplier) ||
              operation.coefficientMultiplier <= 0)
          ) {
            errors.push(`invalid targeting multiplier: ${node.key}`);
          }
          break;
        case 'ADJUST_ENERGY_COST':
        case 'ADJUST_COOLDOWN':
          if (
            !Number.isFinite(operation.flatDelta) ||
            !Number.isInteger(operation.minimum) ||
            operation.minimum < 0
          ) {
            errors.push(`invalid numeric modifier: ${node.key}`);
          }
          break;
        case 'SCALE_EFFECT':
          if (!Number.isFinite(operation.multiplier) || operation.multiplier <= 0) {
            errors.push(`invalid effect multiplier: ${node.key}`);
          }
          break;
        case 'ADD_STATUS_EFFECT':
          if (
            !operation.statusKey.trim() ||
            !Number.isInteger(operation.durationTurns) ||
            operation.durationTurns < 1 ||
            (operation.chance !== undefined &&
              (!Number.isFinite(operation.chance) ||
                operation.chance < 0 ||
                operation.chance > 1))
          ) {
            errors.push(`invalid status modifier: ${node.key}`);
          }
          break;
        case 'CONSUME_STATUS':
          if (!modifiedSkill?.effects.some((effect) => effect.type === 'DAMAGE')) {
            errors.push(`status consumption requires damage: ${node.key}`);
          }
          break;
      }
    }
  }
  for (const node of catalog.nodes) {
    for (const prerequisite of [
      ...node.prerequisiteKeys,
      ...(node.prerequisiteAnyOf?.flat() ?? []),
    ]) {
      const dependency = nodeByKey.get(prerequisite);
      if (!dependency || dependency.characterClass !== node.characterClass) {
        errors.push(`unreachable prerequisite ${prerequisite} from ${node.key}`);
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): void => {
    if (visiting.has(key)) {
      errors.push(`cycle detected at ${key}`);
      return;
    }
    if (visited.has(key)) return;
    visiting.add(key);
    const node = nodeByKey.get(key);
    for (const dependency of [
      ...(node?.prerequisiteKeys ?? []),
      ...(node?.prerequisiteAnyOf?.flat() ?? []),
    ]) {
      visit(dependency);
    }
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of nodeByKey.keys()) visit(key);

  for (const characterClass of ['MAGE', 'WARRIOR', 'ARCHER'] as const) {
    const specializations = catalog.specializations.filter(
      (specialization) => specialization.characterClass === characterClass,
    );
    if (specializations.length < 3) errors.push(`requires three specializations: ${characterClass}`);
    const nodes = catalog.nodes.filter((node) => node.characterClass === characterClass);
    const theoreticalMinimum = nodes
      .filter((node) => node.kind === 'ACTIVE')
      .slice(0, SKILL_BUILD_MAX_ACTIVE_ACTIONS)
      .reduce((sum, node) => sum + node.pointCost, 0);
    if (theoreticalMinimum > calculateBuildPoints(100, 0).earned) {
      errors.push(`class cannot afford a legal active loadout: ${characterClass}`);
    }
  }
  return { valid: errors.length === 0, errors };
};

export const validateCompleteBuild = (input: {
  characterClass: CharacterClass;
  characterLevel: number;
  selectedSpecializationKey?: string;
  ranks: Readonly<Record<string, number>>;
}): BuildValidationResult => {
  const reasons: string[] = [];
  const nodes = skillBuildNodesForClass(input.characterClass);
  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
  for (const [key, rawRank] of Object.entries(input.ranks)) {
    const node = nodeByKey.get(key);
    if (!node) {
      if (rawRank) reasons.push(`UNKNOWN_NODE:${key}`);
      continue;
    }
    const rank = Math.trunc(rawRank);
    if (!Number.isFinite(rawRank) || rank !== rawRank || rank < 0 || rank > node.maxRank) {
      reasons.push(`INVALID_RANK:${key}`);
      continue;
    }
    if (rank === 0) continue;
    if (input.characterLevel < node.minimumLevel) reasons.push(`LEVEL_REQUIRED:${key}`);
    if (
      node.specializationKey &&
      node.specializationKey !== input.selectedSpecializationKey
    ) {
      reasons.push(`SPECIALIZATION_REQUIRED:${key}`);
    }
    for (const prerequisite of node.prerequisiteKeys) {
      if (rankOf(input.ranks, prerequisite) < 1) {
        reasons.push(`PREREQUISITE:${key}:${prerequisite}`);
      }
    }
    for (const alternatives of node.prerequisiteAnyOf ?? []) {
      if (!alternatives.some((candidate) => rankOf(input.ranks, candidate) > 0)) {
        reasons.push(`PREREQUISITE_ANY:${key}:${alternatives.join(',')}`);
      }
    }
  }
  const choiceGroups = new Map<string, string>();
  for (const node of nodes) {
    if (!node.choiceGroupKey || rankOf(input.ranks, node.key) < 1) continue;
    const previous = choiceGroups.get(node.choiceGroupKey);
    if (previous && previous !== node.key) {
      reasons.push(`CHOICE_CONFLICT:${previous}:${node.key}`);
    } else {
      choiceGroups.set(node.choiceGroupKey, node.key);
    }
  }
  const spent = spentBuildPoints(input.characterClass, input.ranks);
  const earned = calculateBuildPoints(input.characterLevel, 0).earned;
  if (spent > earned) reasons.push(`POINT_BUDGET:${spent}:${earned}`);
  if (input.selectedSpecializationKey) {
    const specialization = skillSpecializationsForClass(input.characterClass).find(
      (candidate) => candidate.key === input.selectedSpecializationKey,
    );
    if (!specialization) reasons.push('UNKNOWN_SPECIALIZATION');
  }
  return { valid: reasons.length === 0, reasons: [...new Set(reasons)] };
};
