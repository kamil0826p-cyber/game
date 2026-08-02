import { ENCOUNTER_CATALOG } from './encounter.catalog.js';
import type { EncounterDefinition } from './encounter.types.js';

export function selectLatestEncounterForKey(
  definitions: readonly EncounterDefinition[],
  encounterKey: string,
): EncounterDefinition {
  const encounter = definitions
    .filter((candidate) => candidate.key === encounterKey)
    .sort((left, right) => right.version - left.version)[0];
  if (!encounter) {
    throw new Error(`Missing encounter definition for key ${encounterKey}.`);
  }
  return encounter;
}

export function encounterForKey(encounterKey: string): EncounterDefinition {
  return selectLatestEncounterForKey(ENCOUNTER_CATALOG, encounterKey);
}
