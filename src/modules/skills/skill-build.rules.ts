import type { CharacterClass } from '../../common/domain/game.types.js';
import type { SkillCatalogDefinition } from './skill.types.js';

export interface PersistedSkillRank {
  key: string;
  rank: number;
}

export interface RepairedSkillRank extends PersistedSkillRank {
  originalRank: number;
}

export interface SkillBuildRepairResult {
  kept: RepairedSkillRank[];
  removed: PersistedSkillRank[];
  spentPoints: number;
}

export const repairSkillBuild = (
  characterClass: CharacterClass,
  characterLevel: number,
  pointBudget: number,
  catalog: readonly SkillCatalogDefinition[],
  persisted: readonly PersistedSkillRank[],
): SkillBuildRepairResult => {
  const definitions = catalog
    .filter((skill) => skill.characterClass === characterClass)
    .sort(
      (left, right) =>
        left.displayOrder - right.displayOrder || left.key.localeCompare(right.key),
    );
  const definitionByKey = new Map(definitions.map((definition) => [definition.key, definition]));
  const persistedByKey = new Map<string, PersistedSkillRank>();
  const removed: PersistedSkillRank[] = [];

  for (const entry of [...persisted].sort((left, right) => left.key.localeCompare(right.key))) {
    if (persistedByKey.has(entry.key)) {
      removed.push(entry);
      continue;
    }
    persistedByKey.set(entry.key, entry);
  }

  const kept: RepairedSkillRank[] = [];
  const keptKeys = new Set<string>();
  let spentPoints = 0;
  const safeLevel = Math.max(1, Math.trunc(characterLevel));
  const safeBudget = Math.max(0, Math.trunc(pointBudget));

  for (const definition of definitions) {
    const entry = persistedByKey.get(definition.key);
    if (!entry) continue;
    const originalRank = Math.max(0, Math.trunc(entry.rank));
    const rank = Math.min(definition.maxRank, originalRank);
    const legal =
      rank > 0 &&
      safeLevel >= definition.minimumLevel &&
      definition.prerequisiteKeys.every((key) => keptKeys.has(key)) &&
      spentPoints + rank <= safeBudget;
    if (!legal) {
      removed.push(entry);
      continue;
    }
    kept.push({ key: entry.key, rank, originalRank });
    keptKeys.add(entry.key);
    spentPoints += rank;
  }

  for (const entry of persistedByKey.values()) {
    if (!definitionByKey.has(entry.key)) removed.push(entry);
  }

  return {
    kept,
    removed: removed.sort((left, right) => left.key.localeCompare(right.key)),
    spentPoints,
  };
};
