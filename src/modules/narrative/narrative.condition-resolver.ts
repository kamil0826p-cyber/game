import type {
  NarrativeComparison,
  NarrativeCondition,
  NarrativeConditionContext,
} from './narrative.types.js';

function compare(left: number | string | boolean, comparison: NarrativeComparison, right: number | string | boolean): boolean {
  switch (comparison) {
    case 'EQ': return left === right;
    case 'NE': return left !== right;
    case 'GTE': return typeof left === 'number' && typeof right === 'number' && left >= right;
    case 'LTE': return typeof left === 'number' && typeof right === 'number' && left <= right;
  }
}

export function evaluateNarrativeCondition(
  condition: NarrativeCondition,
  context: NarrativeConditionContext,
): boolean {
  switch (condition.type) {
    case 'ALL': return condition.conditions.every((entry) => evaluateNarrativeCondition(entry, context));
    case 'ANY': return condition.conditions.some((entry) => evaluateNarrativeCondition(entry, context));
    case 'NOT': return !evaluateNarrativeCondition(condition.condition, context);
    case 'LEVEL_AT_LEAST': return context.level >= condition.level;
    case 'CLASS_IS': return context.characterClass === condition.characterClass;
    case 'SPECIALIZATION_IS': return context.character.specializationKey === condition.specializationKey;
    case 'ITEM_OWNED': return (context.inventory.get(condition.itemKey) ?? 0) >= condition.quantity;
    case 'ITEM_USED': return (context.character.usedItems[condition.itemKey] ?? 0) >= condition.quantity;
    case 'QUEST_STATUS': return context.character.questStatuses[condition.questKey] === condition.status;
    case 'FLAG': return compare(context.character.flags[condition.flagKey] ?? false, condition.comparison, condition.value);
    case 'NPC_RELATION': {
      const relation = context.character.npcRelations[condition.npcKey]?.[condition.dimension] ?? 0;
      return compare(relation, condition.comparison, condition.value);
    }
    case 'FACTION_REPUTATION': {
      const reputation = context.character.factionReputations[condition.factionKey]?.value ?? 0;
      return compare(reputation, condition.comparison, condition.value);
    }
    case 'CONSEQUENCE': {
      if (condition.kind === 'CORRUPTION') {
        return compare(context.character.consequences.corruption, condition.comparison ?? 'GTE', Number(condition.value ?? 1));
      }
      if (!condition.key) return false;
      if (condition.kind === 'WOUND') {
        return compare(context.character.consequences.wounds[condition.key] ?? 0, condition.comparison ?? 'GTE', Number(condition.value ?? 1));
      }
      const oath = context.character.consequences.oaths[condition.key];
      return compare(oath ?? '', condition.comparison ?? 'EQ', String(condition.value ?? 'ACTIVE'));
    }
    case 'GUILD_MEMBERSHIP': return Boolean(context.character.guild) === condition.required;
    case 'GUILD_ROLE': return context.character.guild?.role === condition.role;
    case 'PARTY_SIZE': return compare(context.partySize, condition.comparison, condition.value);
    case 'REGION_VALUE': {
      const value = context.regionValues.get(condition.regionKey)?.get(condition.valueKey) ?? 0;
      return compare(value, condition.comparison, condition.value);
    }
    case 'WORLD_CYCLE': return context.worldCycles.get(condition.cycleKey) === condition.phaseKey;
    case 'ENCOUNTER_RESULT': {
      const result = context.encounterResults.get(condition.encounterKey);
      return Boolean(
        result &&
          result.result === condition.result &&
          (!condition.mechanicKey || result.mechanics.has(condition.mechanicKey)),
      );
    }
    default: {
      const exhaustive: never = condition;
      return exhaustive;
    }
  }
}

export function evaluateNarrativeConditions(
  conditions: readonly NarrativeCondition[] | undefined,
  context: NarrativeConditionContext,
): boolean {
  return !conditions || conditions.every((condition) => evaluateNarrativeCondition(condition, context));
}
