import { COMBAT_TEAM_LIMIT } from '../../combat/combat.rules.js';
import { SKILL_CATALOG } from '../../skills/skill.catalog.js';
import { MOB_RANKS } from '../mob.catalog.js';
import type { EncounterDefinition } from './encounter.types.js';
import { ENCOUNTER_PARTY_THRESHOLDS } from './encounter.types.js';

export interface EncounterValidationResult {
  errors: string[];
  warnings: string[];
}

const skillByKey = new Map(SKILL_CATALOG.map((skill) => [skill.key, skill]));
const stableKey = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateEncounterDefinition(
  definition: EncounterDefinition,
): EncounterValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const prefix = `${definition.key}@${definition.version}`;
  const actorKeys = new Set(definition.actors.map((actor) => actor.key));

  if (!stableKey.test(definition.key)) {
    errors.push(`${prefix}: key must be a stable kebab-case identifier.`);
  }
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    errors.push(`${prefix}: version must be a positive integer.`);
  }
  if (
    definition.minimumPartySize < 1 ||
    definition.maximumPartySize > COMBAT_TEAM_LIMIT ||
    definition.minimumPartySize > definition.maximumPartySize
  ) {
    errors.push(`${prefix}: allowed party size must remain within 1-${COMBAT_TEAM_LIMIT}.`);
  }
  if (
    definition.recommendedPartySize < definition.minimumPartySize ||
    definition.recommendedPartySize > definition.maximumPartySize
  ) {
    errors.push(`${prefix}: recommended party size is outside the allowed range.`);
  }
  if (actorKeys.size !== definition.actors.length) {
    errors.push(`${prefix}: actor keys must be unique.`);
  }
  if (definition.initialActorKeys.length !== 1) {
    errors.push(`${prefix}: exactly one root actor must represent the claimed world spawn.`);
  }
  for (const actorKey of definition.initialActorKeys) {
    if (!actorKeys.has(actorKey)) errors.push(`${prefix}: missing initial actor ${actorKey}.`);
  }

  for (const actor of definition.actors) {
    if (!stableKey.test(actor.key)) {
      errors.push(`${prefix}: actor key ${actor.key} must be a stable kebab-case identifier.`);
    }
    if (actor.role !== actor.ai.role) {
      errors.push(`${prefix}: ${actor.key} has inconsistent actor and AI roles.`);
    }
    if (actor.statScale <= 0 || !Number.isFinite(actor.statScale)) {
      errors.push(`${prefix}: ${actor.key} has an invalid stat scale.`);
    }
    if (actor.skillKeys.length === 0 && actor.role !== 'OBJECTIVE') {
      warnings.push(`${prefix}: ${actor.key} has no skill and will rely on tactical/basic actions.`);
    }
    for (const skillKey of actor.skillKeys) {
      const skill = skillByKey.get(skillKey);
      if (!skill) {
        errors.push(`${prefix}: ${actor.key} references missing skill ${skillKey}.`);
        continue;
      }
      const strong = skill.effects.some(
        (effect) => effect.type === 'DAMAGE' && effect.coefficient >= 1.8,
      );
      if (!strong) continue;
      const telegraph = definition.telegraphs.find((rule) => rule.skillKey === skillKey);
      if (!telegraph) {
        errors.push(`${prefix}: strong action ${skillKey} requires a telegraph or an explicit exception.`);
      } else if (!telegraph.unavoidable && telegraph.counters.length === 0) {
        errors.push(`${prefix}: telegraph ${skillKey} has no declared counterplay.`);
      }
    }
  }
  for (const telegraph of definition.telegraphs) {
    if (!skillByKey.has(telegraph.skillKey)) {
      errors.push(`${prefix}: telegraph references missing skill ${telegraph.skillKey}.`);
    }
    if (!definition.actors.some((actor) => actor.skillKeys.includes(telegraph.skillKey))) {
      errors.push(`${prefix}: telegraph ${telegraph.skillKey} is not available to any encounter actor.`);
    }
  }

  const thresholds = definition.scaling.map((tier) => tier.minPartySize);
  if (
    thresholds.length !== ENCOUNTER_PARTY_THRESHOLDS.length ||
    thresholds.some((threshold, index) => threshold !== ENCOUNTER_PARTY_THRESHOLDS[index])
  ) {
    errors.push(`${prefix}: scaling tiers must be defined exactly for party sizes 1, 3, 5 and 10.`);
  }
  for (const tier of definition.scaling) {
    if (tier.actorKeys.length < 1 || tier.actorKeys.length > COMBAT_TEAM_LIMIT) {
      errors.push(`${prefix}: tier ${tier.minPartySize} has an invalid actor count.`);
    }
    if (new Set(tier.actorKeys).size !== tier.actorKeys.length) {
      errors.push(`${prefix}: tier ${tier.minPartySize} contains duplicate actors.`);
    }
    for (const rootActorKey of definition.initialActorKeys) {
      if (!tier.actorKeys.includes(rootActorKey)) {
        errors.push(`${prefix}: tier ${tier.minPartySize} must include root actor ${rootActorKey}.`);
      }
    }
    for (const actorKey of tier.actorKeys) {
      if (!actorKeys.has(actorKey)) {
        errors.push(`${prefix}: tier ${tier.minPartySize} references missing actor ${actorKey}.`);
      }
    }
    if (
      tier.healthMultiplier <= 0 ||
      tier.powerMultiplier <= 0 ||
      tier.rewardMultiplier <= 0 ||
      tier.targetTurns < 1 ||
      tier.telegraphTargetCount < 1 ||
      tier.breakCapacity < 1
    ) {
      errors.push(`${prefix}: tier ${tier.minPartySize} has invalid numeric scaling.`);
    }
  }

  if (definition.phases.length < 3) {
    errors.push(`${prefix}: an encounter must expose at least three readable phases.`);
  }
  if (definition.phases[0]?.conditions.length) {
    errors.push(`${prefix}: the opening phase must be unconditional.`);
  }
  const phaseKeys = new Set<string>();
  const summonKeys = new Set<string>();
  definition.phases.forEach((phase, index) => {
    if (!stableKey.test(phase.key)) {
      errors.push(`${prefix}: phase key ${phase.key} must be a stable kebab-case identifier.`);
    }
    if (phaseKeys.has(phase.key)) errors.push(`${prefix}: duplicate phase ${phase.key}.`);
    phaseKeys.add(phase.key);
    if (index > 0 && phase.conditions.length === 0) {
      errors.push(`${prefix}: phase ${phase.key} is unreachable because it has no transition condition.`);
    }
    for (const condition of phase.conditions) {
      switch (condition.type) {
        case 'TURN_AT_LEAST':
          if (!Number.isInteger(condition.turn) || condition.turn < 1) {
            errors.push(`${prefix}: phase ${phase.key} has an invalid turn condition.`);
          }
          break;
        case 'ENEMY_HP_AT_MOST':
        case 'ACTOR_HP_AT_MOST':
          if (condition.ratio <= 0 || condition.ratio >= 1) {
            errors.push(`${prefix}: phase ${phase.key} has an invalid health ratio.`);
          }
          if (condition.type === 'ACTOR_HP_AT_MOST' && !actorKeys.has(condition.actorKey)) {
            errors.push(`${prefix}: phase ${phase.key} references missing actor ${condition.actorKey}.`);
          }
          break;
        case 'ACTOR_DEFEATED':
        case 'STATUS_ACTIVE':
        case 'BREAK_AT_LEAST':
          if (!actorKeys.has(condition.actorKey)) {
            errors.push(`${prefix}: phase ${phase.key} references missing actor ${condition.actorKey}.`);
          }
          if (
            condition.type === 'STATUS_ACTIVE' &&
            (!condition.statusKey || condition.statusKey.trim() !== condition.statusKey)
          ) {
            errors.push(`${prefix}: phase ${phase.key} has an invalid status key.`);
          }
          if (
            condition.type === 'BREAK_AT_LEAST' &&
            (!Number.isInteger(condition.stacks) || condition.stacks < 1)
          ) {
            errors.push(`${prefix}: phase ${phase.key} has an invalid break threshold.`);
          }
          break;
        case 'TELEGRAPH_RESOLVED':
          if (!skillByKey.has(condition.skillKey)) {
            errors.push(`${prefix}: phase ${phase.key} references missing skill ${condition.skillKey}.`);
          }
          if (!definition.telegraphs.some((rule) => rule.skillKey === condition.skillKey)) {
            errors.push(`${prefix}: phase ${phase.key} references undeclared telegraph ${condition.skillKey}.`);
          }
          break;
        case 'LIVING_PLAYERS_AT_MOST':
          if (!Number.isInteger(condition.count) || condition.count < 0) {
            errors.push(`${prefix}: phase ${phase.key} has an invalid living-player threshold.`);
          }
          break;
        case 'INTERACTION_USED':
          if (!stableKey.test(condition.interactionKey)) {
            errors.push(`${prefix}: phase ${phase.key} has an invalid interaction key.`);
          }
          break;
      }
    }
    for (const actorKey of phase.summonActorKeys ?? []) {
      summonKeys.add(actorKey);
      if (!actorKeys.has(actorKey)) {
        errors.push(`${prefix}: phase ${phase.key} summons missing actor ${actorKey}.`);
      }
    }
  });

  if (summonKeys.size > definition.summonLimit) {
    errors.push(`${prefix}: phases summon ${summonKeys.size} actors but the limit is ${definition.summonLimit}.`);
  }
  for (const tier of definition.scaling) {
    const maximumActors = new Set([...tier.actorKeys, ...summonKeys]).size;
    if (maximumActors > COMBAT_TEAM_LIMIT) {
      errors.push(
        `${prefix}: tier ${tier.minPartySize} can create ${maximumActors} actors, above the combat limit.`,
      );
    }
  }

  if (definition.victory.type === 'DEFEAT_ACTOR') {
    if (!definition.victory.actorKey || !actorKeys.has(definition.victory.actorKey)) {
      errors.push(`${prefix}: actor victory condition references an unknown actor.`);
    }
  }
  if (
    definition.defeat.type === 'TURN_LIMIT' &&
    (!definition.defeat.turnLimit || !Number.isInteger(definition.defeat.turnLimit) || definition.defeat.turnLimit < 1)
  ) {
    errors.push(`${prefix}: turn-limit defeat requires a positive integer limit.`);
  }
  if (
    definition.reward.minimumActiveTurnRatio < 0 ||
    definition.reward.minimumActiveTurnRatio > 1 ||
    definition.reward.lateJoinCutoff <= 0 ||
    definition.reward.lateJoinCutoff > 1 ||
    definition.reward.minimumContribution < 0
  ) {
    errors.push(`${prefix}: reward eligibility configuration is invalid.`);
  }

  return { errors, warnings };
}

export function assertEncounterCatalog(definitions: readonly EncounterDefinition[]): void {
  const versions = new Set<string>();
  const rankOwners = new Map<string, string>();
  const errors: string[] = [];
  for (const definition of definitions) {
    const identity = `${definition.key}@${definition.version}`;
    if (versions.has(identity)) errors.push(`Duplicate encounter version ${identity}.`);
    versions.add(identity);
    for (const rank of definition.ranks) {
      const existing = rankOwners.get(rank);
      if (existing && existing !== definition.key) {
        errors.push(`Mob rank ${rank} is assigned to both ${existing} and ${definition.key}.`);
      } else {
        rankOwners.set(rank, definition.key);
      }
    }
    errors.push(...validateEncounterDefinition(definition).errors);
  }
  for (const rank of MOB_RANKS) {
    if (!rankOwners.has(rank)) errors.push(`Mob rank ${rank} has no encounter definition.`);
  }
  if (errors.length > 0) throw new Error(`INVALID_ENCOUNTER_CATALOG\n${errors.join('\n')}`);
}
