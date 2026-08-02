import type { ScaledEncounter } from '../mobs/encounters/encounter.types.js';

const appendUnique = <T>(values: readonly T[], value: T): T[] =>
  values.includes(value) ? [...values] : [...values, value];

export function applyExpeditionEncounterVariant(
  source: ScaledEncounter,
  variantKey: string | undefined,
): ScaledEncounter {
  if (!variantKey) return source;
  const encounter = structuredClone(source);
  const opening = encounter.definition.phases[0];

  if (variantKey === 'salted-chains') {
    encounter.definition.difficulty = 'RITUAL';
    encounter.definition.name = `${encounter.definition.name}: Posolone Łańcuchy`;
    encounter.tier = {
      ...encounter.tier,
      mechanics: appendUnique(encounter.tier.mechanics, 'SALTED_CHAINS'),
      powerMultiplier: Math.max(0.1, encounter.tier.powerMultiplier * 0.95),
    };
    encounter.definition.actors = encounter.definition.actors.map((actor) => {
      if (actor.role === 'LEADER') {
        return { ...actor, statScale: actor.statScale * 0.9 };
      }
      if (actor.role === 'FRONTLINER') {
        return {
          ...actor,
          ai: {
            ...actor.ai,
            actionWeights: {
              ...actor.ai.actionWeights,
              INTERCEPT: Math.max(1, Math.floor((actor.ai.actionWeights.INTERCEPT ?? 1) / 2)),
            },
          },
        };
      }
      return actor;
    });
    encounter.definition.telegraphs = encounter.definition.telegraphs.map((telegraph) => ({
      ...telegraph,
      counters: appendUnique(telegraph.counters, 'INTERRUPT'),
    }));
    if (opening) opening.mechanics = appendUnique(opening.mechanics, 'SALTED_CHAINS');
    return encounter;
  }

  if (variantKey === 'blind-lantern') {
    encounter.definition.difficulty = 'RITUAL';
    encounter.definition.name = `${encounter.definition.name}: Ślepa Latarnia`;
    encounter.tier = {
      ...encounter.tier,
      mechanics: appendUnique(encounter.tier.mechanics, 'BLIND_LANTERN'),
      telegraphTargetCount: Math.max(1, encounter.tier.telegraphTargetCount - 1),
    };
    encounter.definition.actors = encounter.definition.actors.map((actor) =>
      actor.role === 'LEADER'
        ? {
            ...actor,
            ai: {
              ...actor.ai,
              targetPolicy: 'FRONT_LINE',
            },
          }
        : actor,
    );
    encounter.definition.telegraphs = encounter.definition.telegraphs.map((telegraph) => ({
      ...telegraph,
      counters: appendUnique(telegraph.counters, 'REPOSITION'),
    }));
    if (opening) {
      opening.arenaModifier = 'BLIND_LANTERN';
      opening.mechanics = appendUnique(opening.mechanics, 'BLIND_LANTERN');
    }
    return encounter;
  }

  if (variantKey === 'unprepared-nemesis') {
    encounter.definition.difficulty = 'RITUAL';
    encounter.definition.name = `${encounter.definition.name}: Nieprzygotowana Nemezis`;
    encounter.tier = {
      ...encounter.tier,
      mechanics: appendUnique(encounter.tier.mechanics, 'UNPREPARED_NEMESIS'),
      powerMultiplier: encounter.tier.powerMultiplier * 1.1,
    };
    return encounter;
  }

  throw new Error(`EXPEDITION_ENCOUNTER_VARIANT_UNKNOWN:${variantKey}`);
}
