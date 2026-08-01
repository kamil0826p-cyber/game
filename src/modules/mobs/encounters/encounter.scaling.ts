import type {
  EncounterDefinition,
  EncounterPartyThreshold,
  ScaledEncounter,
} from './encounter.types.js';

export interface EncounterDryRunRow {
  partySize: EncounterPartyThreshold;
  actorCount: number;
  summonCapacity: number;
  telegraphTargetCount: number;
  breakCapacity: number;
  targetTurns: number;
  healthMultiplier: number;
  powerMultiplier: number;
  rewardMultiplier: number;
  mechanics: string[];
}

export function scaleEncounter(
  definition: EncounterDefinition,
  partySize: number,
): ScaledEncounter {
  const normalizedPartySize = Math.max(1, Math.min(10, Math.trunc(partySize)));
  if (
    normalizedPartySize < definition.minimumPartySize ||
    normalizedPartySize > definition.maximumPartySize
  ) {
    throw new Error('ENCOUNTER_PARTY_SIZE_INVALID');
  }
  const tier = [...definition.scaling]
    .sort((left, right) => right.minPartySize - left.minPartySize)
    .find((candidate) => normalizedPartySize >= candidate.minPartySize);
  if (!tier) throw new Error('ENCOUNTER_SCALING_MISSING');
  const pendingSummonKeys = [
    ...new Set(definition.phases.flatMap((phase) => phase.summonActorKeys ?? [])),
  ].filter((actorKey) => !tier.actorKeys.includes(actorKey));
  return {
    definition,
    tier,
    partySize: normalizedPartySize,
    initialActorKeys: [...tier.actorKeys],
    pendingSummonKeys,
  };
}

export function dryRunEncounter(definition: EncounterDefinition): EncounterDryRunRow[] {
  return definition.scaling.map((tier) => {
    const scaled = scaleEncounter(definition, tier.minPartySize);
    return {
      partySize: tier.minPartySize,
      actorCount: scaled.initialActorKeys.length,
      summonCapacity: scaled.pendingSummonKeys.length,
      telegraphTargetCount: tier.telegraphTargetCount,
      breakCapacity: tier.breakCapacity,
      targetTurns: tier.targetTurns,
      healthMultiplier: tier.healthMultiplier,
      powerMultiplier: tier.powerMultiplier,
      rewardMultiplier: tier.rewardMultiplier,
      mechanics: [...tier.mechanics],
    };
  });
}
