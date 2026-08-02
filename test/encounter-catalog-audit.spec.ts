import { describe, expect, it } from 'vitest';
import { ENCOUNTER_CATALOG } from '../src/modules/mobs/encounters/encounter.catalog.js';
import {
  encounterForMob,
  selectLatestEncounterForKey,
} from '../src/modules/mobs/encounters/encounter.registry.js';
import type { EncounterDefinition } from '../src/modules/mobs/encounters/encounter.types.js';
import { assertEncounterCatalog } from '../src/modules/mobs/encounters/encounter.validator.js';

const clone = (definition: EncounterDefinition): EncounterDefinition =>
  JSON.parse(JSON.stringify(definition)) as EncounterDefinition;

describe('encounter catalog audit', () => {
  it('selects the highest available encounter version for an encounter key', () => {
    const current = ENCOUNTER_CATALOG.find((entry) => entry.key === 'execution-circle')!;
    const oldVersion = { ...clone(current), version: 1 };
    const newVersion = { ...clone(current), version: 3 };
    const middleVersion = { ...clone(current), version: 2 };

    expect(
      selectLatestEncounterForKey(
        [oldVersion, newVersion, middleVersion],
        'execution-circle',
      ).version,
    ).toBe(3);
  });

  it('fails loudly when an encounter key has no definition', () => {
    expect(() => selectLatestEncounterForKey([], 'missing-encounter')).toThrow(
      'Missing encounter definition for key missing-encounter.',
    );
  });

  it('allows multiple encounter families to support the same mob rank', () => {
    const current = ENCOUNTER_CATALOG.find((entry) => entry.key === 'brood-hunt')!;
    const alternative = {
      ...clone(current),
      key: 'forest-ambush',
      version: 1,
      name: 'Leśna zasadzka',
    };

    expect(() => assertEncounterCatalog([...ENCOUNTER_CATALOG, alternative])).not.toThrow();
  });

  it('resolves a mob encounter by explicit key and checks rank compatibility', () => {
    expect(encounterForMob('brood-hunt', 'SPAWN').key).toBe('brood-hunt');
    expect(() => encounterForMob('brood-hunt', 'ANCIENT')).toThrow(
      'Encounter brood-hunt does not support mob rank ANCIENT.',
    );
  });
});
