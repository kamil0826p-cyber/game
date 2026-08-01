import { describe, expect, it } from 'vitest';
import {
  ENCOUNTER_CATALOG,
  selectLatestEncounterForRank,
} from '../src/modules/mobs/encounters/encounter.catalog.js';
import type { EncounterDefinition } from '../src/modules/mobs/encounters/encounter.types.js';

const clone = (definition: EncounterDefinition): EncounterDefinition =>
  JSON.parse(JSON.stringify(definition)) as EncounterDefinition;

describe('encounter catalog audit', () => {
  it('selects the highest available encounter version for a mob rank', () => {
    const current = ENCOUNTER_CATALOG.find((entry) =>
      entry.ranks.includes('EXECUTIONER' as never),
    )!;
    const oldVersion = { ...clone(current), version: 1 };
    const newVersion = { ...clone(current), version: 3 };
    const middleVersion = { ...clone(current), version: 2 };

    expect(
      selectLatestEncounterForRank(
        [oldVersion, newVersion, middleVersion],
        'EXECUTIONER',
      ).version,
    ).toBe(3);
  });

  it('fails loudly when a rank has no encounter definition', () => {
    expect(() => selectLatestEncounterForRank([], 'SPAWN')).toThrow(
      'Missing encounter definition for mob rank SPAWN.',
    );
  });
});
