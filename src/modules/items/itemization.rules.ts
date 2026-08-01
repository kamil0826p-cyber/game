import { createHash } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import type {
  CombatEffectOperation,
  SkillCatalogDefinition,
} from '../skills/skill.types.js';
import type {
  SkillCombatLoadout,
  SkillModifierOperation,
} from '../skills/skill.buildcraft.types.js';
import { ITEM_AFFIX_POOLS, ITEM_CURSES, ITEM_RELICS } from './itemization.catalog.js';
import {
  ITEM_AFFIX_RULES_VERSION,
  ITEM_LOOT_PROTECTION_VERSION,
  ITEM_RELIC_RULES_VERSION,
  ITEM_SNAPSHOT_VERSION,
  ITEM_TRIGGER_MAX_DEPTH,
  type ItemAffixDefinition,
  type ItemDefinitionMetadata,
  type ItemEquipPreview,
  type ItemInstanceSnapshot,
  type ItemOriginSnapshot,
  type ItemStatBonuses,
  type ItemStatKey,
  type LootProtectionResult,
  type RolledItemAffix,
} from './itemization.types.js';

const ITEM_STAT_KEYS: readonly ItemStatKey[] = [
  'strength',
  'agility',
  'intelligence',
  'armor',
  'maxHp',
  'maxEnergy',
];
const ITEM_CATEGORIES = new Set(['EQUIPMENT', 'CONSUMABLE', 'MATERIAL', 'QUEST']);
const ITEM_RARITIES = new Set(['COMMON', 'ARTIFACT', 'MYTHIC']);
const MAX_ACTIVE_RELICS = 2;

class SeededRandom {
  private counter = 0;

  constructor(private readonly seed: string) {}

  next(): number {
    const digest = createHash('sha256')
      .update(`${this.seed}:${this.counter++}`)
      .digest();
    return digest.readUInt32BE(0) / 0x1_0000_0000;
  }

  integer(minimum: number, maximum: number): number {
    if (maximum <= minimum) return minimum;
    return minimum + Math.floor(this.next() * (maximum - minimum + 1));
  }
}

export const itemSnapshotHash = (snapshot: ItemInstanceSnapshot): string =>
  createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');

const finiteInteger = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;

export const parseItemDefinitionMetadata = (value: Prisma.JsonValue): ItemDefinitionMetadata => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ITEM_METADATA_INVALID');
  }
  const raw = value as Record<string, unknown>;
  if (!ITEM_CATEGORIES.has(String(raw.category))) throw new Error('ITEM_CATEGORY_INVALID');
  if (!ITEM_RARITIES.has(String(raw.rarity))) throw new Error('ITEM_RARITY_INVALID');
  if (typeof raw.icon !== 'string' || raw.icon.length === 0) throw new Error('ITEM_ICON_INVALID');
  if (!Number.isInteger(raw.buyPriceSilver) || !Number.isInteger(raw.sellPriceSilver)) {
    throw new Error('ITEM_PRICE_INVALID');
  }
  const metadata = raw as unknown as ItemDefinitionMetadata;
  if (metadata.category === 'EQUIPMENT') {
    if (!metadata.equipmentSlot) throw new Error('ITEM_EQUIPMENT_SLOT_INVALID');
    if (finiteInteger(metadata.minimumLevel, 0) < 1) throw new Error('ITEM_LEVEL_INVALID');
  }
  return metadata;
};

const defaultMechanics = (
  definitionKey: string,
  metadata: ItemDefinitionMetadata,
): NonNullable<ItemDefinitionMetadata['mechanics']> => ({
  version: 1,
  archetypeKey: definitionKey,
  powerLevel: Math.max(1, metadata.minimumLevel ?? 1),
  powerBudget: 0,
  bindPolicy: metadata.category === 'QUEST' ? 'ON_PICKUP' : 'NONE',
  tradePolicy: metadata.category === 'QUEST' ? 'CHARACTER_BOUND' : 'TRADEABLE',
  salvagePolicy: metadata.category === 'QUEST' ? 'FORBIDDEN' : 'ALLOWED',
});

const normalizeOrigin = (origin: ItemOriginSnapshot): ItemOriginSnapshot => ({
  ...origin,
  contentVersion: Math.max(1, Math.trunc(origin.contentVersion)),
  generatedAt: new Date(origin.generatedAt).toISOString(),
});

const rollValue = (definition: ItemAffixDefinition, random: SeededRandom): number =>
  random.integer(definition.minimumRoll, definition.maximumRoll);

const affixConflicts = (
  definition: ItemAffixDefinition,
  selected: readonly RolledItemAffix[],
): boolean => {
  const selectedTags = new Set(selected.flatMap((affix) => affix.tags));
  if (definition.incompatibleTags.some((tag) => selectedTags.has(tag))) return true;
  return selected.some((affix) =>
    affix.tags.some((tag) => definition.incompatibleTags.includes(tag)),
  );
};

const weightedPick = (
  candidates: readonly ItemAffixDefinition[],
  random: SeededRandom,
): ItemAffixDefinition | undefined => {
  const total = candidates.reduce((sum, candidate) => sum + Math.max(0, candidate.weight), 0);
  if (total <= 0) return undefined;
  let cursor = random.next() * total;
  for (const candidate of candidates) {
    cursor -= Math.max(0, candidate.weight);
    if (cursor <= 0) return candidate;
  }
  return candidates.at(-1);
};

const rollAffixes = (input: {
  poolKey?: string;
  minimum: number;
  maximum: number;
  powerLevel: number;
  availableBudget: number;
  requiredClass?: ItemDefinitionMetadata['requiredClass'];
  seed: string;
}): RolledItemAffix[] => {
  if (!input.poolKey || input.availableBudget <= 0) return [];
  const pool = ITEM_AFFIX_POOLS[input.poolKey];
  if (!pool) throw new Error(`ITEM_AFFIX_POOL_UNKNOWN:${input.poolKey}`);
  const random = new SeededRandom(`${input.seed}:affixes:v${ITEM_AFFIX_RULES_VERSION}`);
  const requested = random.integer(
    Math.max(0, input.minimum),
    Math.max(input.minimum, input.maximum),
  );
  const selected: RolledItemAffix[] = [];
  let spent = 0;

  for (let index = 0; index < requested; index += 1) {
    const candidates = pool.filter((candidate) => {
      if (candidate.minimumPowerLevel > input.powerLevel) return false;
      if (spent + candidate.powerCost > input.availableBudget) return false;
      if (selected.some((affix) => affix.key === candidate.key)) return false;
      if (selected.some((affix) => affix.kind === candidate.kind)) return false;
      if (
        candidate.classTags?.length &&
        input.requiredClass &&
        !candidate.classTags.includes(input.requiredClass)
      ) {
        return false;
      }
      return !affixConflicts(candidate, selected);
    });
    const definition = weightedPick(candidates, random);
    if (!definition) break;
    const roll = rollValue(definition, random);
    selected.push({
      key: definition.key,
      name: definition.name,
      kind: definition.kind,
      tier: definition.tier,
      roll,
      minimumRoll: definition.minimumRoll,
      maximumRoll: definition.maximumRoll,
      powerCost: definition.powerCost,
      tags: [...definition.tags],
      statBonuses: { [definition.stat]: roll },
    });
    spent += definition.powerCost;
  }
  return selected;
};

export const createItemInstanceSnapshot = (input: {
  definitionKey: string;
  metadata: ItemDefinitionMetadata;
  seed: string;
  origin: ItemOriginSnapshot;
  craftQuality?: number;
}): ItemInstanceSnapshot => {
  const mechanics = input.metadata.mechanics ?? defaultMechanics(input.definitionKey, input.metadata);
  const relicDefinition = mechanics.relicKey ? ITEM_RELICS[mechanics.relicKey] : undefined;
  if (mechanics.relicKey && !relicDefinition) {
    throw new Error(`ITEM_RELIC_UNKNOWN:${mechanics.relicKey}`);
  }
  const curseDefinition = mechanics.curseKey ? ITEM_CURSES[mechanics.curseKey] : undefined;
  if (mechanics.curseKey && !curseDefinition) {
    throw new Error(`ITEM_CURSE_UNKNOWN:${mechanics.curseKey}`);
  }
  const fixedPower = (relicDefinition?.powerCost ?? 0) - (curseDefinition?.powerCredit ?? 0);
  if (fixedPower > mechanics.powerBudget) throw new Error('ITEM_POWER_BUDGET_EXCEEDED');
  const count = mechanics.affixCount ?? { minimum: 0, maximum: 0 };
  const affixes = rollAffixes({
    poolKey: mechanics.affixPoolKey,
    minimum: count.minimum,
    maximum: count.maximum,
    powerLevel: mechanics.powerLevel,
    availableBudget: mechanics.powerBudget - Math.max(0, fixedPower),
    requiredClass: input.metadata.requiredClass,
    seed: input.seed,
  });
  const powerSpent =
    fixedPower + affixes.reduce((sum, affix) => sum + Math.max(0, affix.powerCost), 0);
  const created: ItemInstanceSnapshot = {
    version: ITEM_SNAPSHOT_VERSION,
    affixRulesVersion: ITEM_AFFIX_RULES_VERSION,
    relicRulesVersion: ITEM_RELIC_RULES_VERSION,
    definitionKey: input.definitionKey,
    archetypeKey: mechanics.archetypeKey,
    category: input.metadata.category,
    equipmentSlot: input.metadata.equipmentSlot,
    requiredClass: input.metadata.requiredClass,
    rarity: input.metadata.rarity,
    powerLevel: mechanics.powerLevel,
    powerBudget: mechanics.powerBudget,
    powerSpent,
    seed: input.seed,
    affixes,
    relic: relicDefinition
      ? { ...relicDefinition, modifier: { ...relicDefinition.modifier }, rulesVersion: ITEM_RELIC_RULES_VERSION }
      : undefined,
    curse: curseDefinition
      ? { ...curseDefinition, cost: { ...curseDefinition.cost }, rulesVersion: ITEM_RELIC_RULES_VERSION }
      : undefined,
    craftQuality: Math.max(0, Math.min(100, Math.trunc(input.craftQuality ?? 0))),
    origin: normalizeOrigin(input.origin),
    bindPolicy: mechanics.bindPolicy,
    tradePolicy: mechanics.tradePolicy,
    salvagePolicy: mechanics.salvagePolicy,
    mutations: [],
  };
  created.mutations.push({
    sequence: 1,
    operationId: input.origin.operationId,
    type: input.origin.source === 'CRAFT' ? 'CRAFT' : 'CREATE',
    at: created.origin.generatedAt,
    afterHash: itemSnapshotHash({ ...created, mutations: [] }),
  });
  validateItemInstanceSnapshot(created, input.definitionKey, input.metadata);
  return created;
};

const snapshotCandidate = (value: Prisma.JsonValue): unknown => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  return raw.itemization ?? (raw.version === ITEM_SNAPSHOT_VERSION ? raw : undefined);
};

export const readItemInstanceSnapshot = (input: {
  instanceData: Prisma.JsonValue;
  definitionKey: string;
  metadata: ItemDefinitionMetadata;
  legacyOperationId?: string;
}): ItemInstanceSnapshot => {
  const candidate = snapshotCandidate(input.instanceData);
  if (candidate) {
    validateItemInstanceSnapshot(candidate, input.definitionKey, input.metadata);
    return candidate as ItemInstanceSnapshot;
  }
  return createItemInstanceSnapshot({
    definitionKey: input.definitionKey,
    metadata: input.metadata,
    seed: `legacy:${input.definitionKey}`,
    origin: {
      source: 'LEGACY',
      sourceKey: input.definitionKey,
      operationId: input.legacyOperationId ?? `legacy:${input.definitionKey}`,
      contentVersion: 1,
      generatedAt: new Date(0).toISOString(),
    },
  });
};

export const writeItemInstanceData = (
  current: Prisma.JsonValue | undefined,
  snapshot: ItemInstanceSnapshot,
): Prisma.InputJsonValue => {
  const raw = current && typeof current === 'object' && !Array.isArray(current)
    ? { ...(current as Record<string, unknown>) }
    : {};
  return JSON.parse(JSON.stringify({ ...raw, itemization: snapshot })) as Prisma.InputJsonValue;
};

export function validateItemInstanceSnapshot(
  value: unknown,
  definitionKey: string,
  metadata: ItemDefinitionMetadata,
): asserts value is ItemInstanceSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ITEM_SNAPSHOT_INVALID');
  }
  const snapshot = value as ItemInstanceSnapshot;
  if (
    snapshot.version !== ITEM_SNAPSHOT_VERSION ||
    snapshot.affixRulesVersion !== ITEM_AFFIX_RULES_VERSION ||
    snapshot.relicRulesVersion !== ITEM_RELIC_RULES_VERSION
  ) {
    throw new Error('ITEM_SNAPSHOT_VERSION_UNSUPPORTED');
  }
  if (snapshot.definitionKey !== definitionKey) throw new Error('ITEM_SNAPSHOT_DEFINITION_MISMATCH');
  if (snapshot.category !== metadata.category || snapshot.rarity !== metadata.rarity) {
    throw new Error('ITEM_SNAPSHOT_METADATA_MISMATCH');
  }
  if (!Number.isInteger(snapshot.powerBudget) || snapshot.powerBudget < 0) {
    throw new Error('ITEM_POWER_BUDGET_INVALID');
  }
  if (!Array.isArray(snapshot.affixes)) throw new Error('ITEM_AFFIXES_INVALID');
  const kinds = new Set<string>();
  const tags = new Set<string>();
  let affixPower = 0;
  for (const affix of snapshot.affixes) {
    if (kinds.has(affix.kind)) throw new Error('ITEM_AFFIX_KIND_DUPLICATE');
    kinds.add(affix.kind);
    if (
      !Number.isInteger(affix.roll) ||
      affix.roll < affix.minimumRoll ||
      affix.roll > affix.maximumRoll
    ) {
      throw new Error('ITEM_AFFIX_ROLL_INVALID');
    }
    const definition = Object.values(ITEM_AFFIX_POOLS)
      .flat()
      .find((candidate) => candidate.key === affix.key);
    if (!definition) throw new Error('ITEM_AFFIX_UNKNOWN');
    if (definition.incompatibleTags.some((tag) => tags.has(tag))) {
      throw new Error('ITEM_AFFIX_INCOMPATIBLE');
    }
    for (const tag of affix.tags) tags.add(tag);
    affixPower += affix.powerCost;
  }
  if (snapshot.relic && ITEM_RELICS[snapshot.relic.key]?.key !== snapshot.relic.key) {
    throw new Error('ITEM_RELIC_UNKNOWN');
  }
  if (snapshot.curse && ITEM_CURSES[snapshot.curse.key]?.key !== snapshot.curse.key) {
    throw new Error('ITEM_CURSE_UNKNOWN');
  }
  const expectedPower =
    affixPower + (snapshot.relic?.powerCost ?? 0) - (snapshot.curse?.powerCredit ?? 0);
  if (snapshot.powerSpent !== expectedPower || snapshot.powerSpent > snapshot.powerBudget) {
    throw new Error('ITEM_POWER_BUDGET_EXCEEDED');
  }
  if (!snapshot.origin?.operationId || !snapshot.origin.generatedAt) {
    throw new Error('ITEM_ORIGIN_INVALID');
  }
  if (!Array.isArray(snapshot.mutations) || snapshot.mutations.length === 0) {
    throw new Error('ITEM_MUTATION_HISTORY_INVALID');
  }
}

const addBonuses = (target: ItemStatBonuses, bonuses: ItemStatBonuses | undefined): void => {
  for (const key of ITEM_STAT_KEYS) {
    const value = bonuses?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      target[key] = Math.trunc((target[key] ?? 0) + value);
    }
  }
};

export const itemInstanceStatBonuses = (snapshot: ItemInstanceSnapshot): ItemStatBonuses => {
  const result: ItemStatBonuses = {};
  for (const affix of snapshot.affixes) addBonuses(result, affix.statBonuses);
  if (snapshot.curse?.cost.type === 'STAT_PENALTY') {
    addBonuses(result, snapshot.curse.cost.statBonuses);
  }
  return result;
};

export const effectiveItemStatBonuses = (
  metadata: ItemDefinitionMetadata,
  snapshot: ItemInstanceSnapshot,
): ItemStatBonuses => {
  const result: ItemStatBonuses = {};
  addBonuses(result, metadata.statBonuses);
  addBonuses(result, itemInstanceStatBonuses(snapshot));
  return result;
};

export const itemStackKey = (
  definitionKey: string,
  metadata: ItemDefinitionMetadata,
  snapshot: ItemInstanceSnapshot,
): string => {
  if (metadata.category !== 'EQUIPMENT') return definitionKey;
  return `${definitionKey}:${itemSnapshotHash(snapshot)}`;
};

export const buildItemEquipPreview = (
  metadata: ItemDefinitionMetadata,
  snapshot: ItemInstanceSnapshot,
): ItemEquipPreview => {
  const previewPayload = {
    definitionKey: snapshot.definitionKey,
    snapshotHash: itemSnapshotHash(snapshot),
    curse: snapshot.curse?.key,
    relic: snapshot.relic?.key,
    boundCharacterId: snapshot.boundCharacterId,
  };
  return {
    confirmationHash: createHash('sha256').update(JSON.stringify(previewPayload)).digest('hex'),
    requiresConfirmation: Boolean(snapshot.curse),
    relic: snapshot.relic
      ? {
          key: snapshot.relic.key,
          name: snapshot.relic.name,
          description: snapshot.relic.description,
          skillKey: snapshot.relic.skillKey,
        }
      : undefined,
    curse: snapshot.curse
      ? {
          key: snapshot.curse.key,
          name: snapshot.curse.name,
          description: snapshot.curse.description,
          preview: snapshot.curse.preview,
          cost: snapshot.curse.cost,
        }
      : undefined,
    effectiveStatBonuses: effectiveItemStatBonuses(metadata, snapshot),
  };
};

const scaleEffect = (
  effect: CombatEffectOperation,
  multiplier: number,
): CombatEffectOperation => {
  if (effect.type === 'DAMAGE') {
    return {
      ...effect,
      coefficient: Number((effect.coefficient * multiplier).toFixed(4)),
      bonusCoefficient:
        effect.bonusCoefficient === undefined
          ? undefined
          : Number((effect.bonusCoefficient * multiplier).toFixed(4)),
    };
  }
  if (effect.type === 'HEAL' || effect.type === 'SHIELD') {
    return { ...effect, coefficient: Number((effect.coefficient * multiplier).toFixed(4)) };
  }
  if (effect.type === 'APPLY_STATUS') {
    return {
      ...effect,
      magnitude:
        effect.magnitude === undefined
          ? undefined
          : Number((effect.magnitude * multiplier).toFixed(4)),
    };
  }
  return { ...effect };
};

export const applyItemSkillModifier = (
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

export const applyEquippedRelicsToLoadout = (
  loadout: SkillCombatLoadout,
  snapshots: readonly ItemInstanceSnapshot[],
): SkillCombatLoadout => {
  const relics = snapshots.flatMap((snapshot) => snapshot.relic ? [snapshot.relic] : []);
  const groups = new Set<string>();
  const active = relics.filter((relic) => {
    if (groups.has(relic.uniqueGroup)) return false;
    groups.add(relic.uniqueGroup);
    return true;
  });
  if (active.length > MAX_ACTIVE_RELICS) throw new Error('ITEM_RELIC_ACTIVE_LIMIT');
  return {
    ...loadout,
    definitions: loadout.definitions.map((entry) => {
      const matching = active.filter((relic) => relic.skillKey === entry.definition.key);
      return {
        ...entry,
        definition: matching.reduce(
          (definition, relic) => applyItemSkillModifier(definition, relic.modifier),
          entry.definition,
        ),
      };
    }),
  };
};

export class ItemTriggerRecursionGuard {
  private readonly stack: string[] = [];

  run<T>(triggerKey: string, operation: () => T): T {
    if (this.stack.length >= ITEM_TRIGGER_MAX_DEPTH) throw new Error('ITEM_TRIGGER_DEPTH_EXCEEDED');
    if (this.stack.includes(triggerKey)) throw new Error('ITEM_TRIGGER_RECURSION_BLOCKED');
    this.stack.push(triggerKey);
    try {
      return operation();
    } finally {
      this.stack.pop();
    }
  }
}

export const resolveLootProtection = (input: {
  chance: number;
  roll: number;
  misses: number;
  guaranteedAfterMisses: number;
  uniqueKey?: string;
  ownedUniqueKeys?: readonly string[];
  duplicateHasValue?: boolean;
}): LootProtectionResult => {
  const duplicateBlocked = Boolean(
    input.uniqueKey &&
    input.ownedUniqueKeys?.includes(input.uniqueKey) &&
    input.duplicateHasValue === false,
  );
  if (duplicateBlocked) {
    return { granted: false, guaranteed: false, duplicateBlocked: true, nextMisses: input.misses };
  }
  const guaranteed = input.misses >= Math.max(0, input.guaranteedAfterMisses);
  const granted = guaranteed || input.roll < Math.max(0, Math.min(1, input.chance));
  return {
    granted,
    guaranteed,
    duplicateBlocked: false,
    nextMisses: granted ? 0 : input.misses + 1,
  };
};

export const lootProtectionRulesVersion = ITEM_LOOT_PROTECTION_VERSION;
