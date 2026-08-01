import type { CombatActorInput } from '../../combat/combat.types.js';
import { SKILL_CATALOG } from '../../skills/skill.catalog.js';
import type { RuntimeMob } from '../mob.types.js';
import type {
  ClaimedEncounter,
  EncounterActorTemplate,
  ScaledEncounter,
} from './encounter.types.js';

const skillByKey = new Map(SKILL_CATALOG.map((skill) => [skill.key, skill]));

export function encounterActorId(rootMobId: string, actorKey: string, rootKey: string): string {
  return actorKey === rootKey ? `mob:${rootMobId}` : `encounter:${rootMobId}:${actorKey}`;
}

export function buildClaimedEncounter(
  mob: RuntimeMob,
  encounter: ScaledEncounter,
): ClaimedEncounter {
  const rootKey = encounter.definition.initialActorKeys[0];
  if (!rootKey) throw new Error('ENCOUNTER_ROOT_ACTOR_MISSING');
  const templates = new Map(
    encounter.definition.actors.map((actor) => [actor.key, actor]),
  );
  const build = (actorKey: string): CombatActorInput => {
    const template = templates.get(actorKey);
    if (!template) throw new Error(`ENCOUNTER_ACTOR_MISSING:${actorKey}`);
    return buildActor(mob, encounter, template, rootKey);
  };
  return {
    rootActorId: encounterActorId(mob.id, rootKey, rootKey),
    encounter,
    initialActors: encounter.initialActorKeys.map(build),
    pendingActors: new Map(
      encounter.pendingSummonKeys.map((actorKey) => [actorKey, build(actorKey)]),
    ),
  };
}

function buildActor(
  mob: RuntimeMob,
  encounter: ScaledEncounter,
  template: EncounterActorTemplate,
  rootKey: string,
): CombatActorInput {
  const root = template.key === rootKey;
  const healthScale = template.statScale * encounter.tier.healthMultiplier;
  const powerScale = template.statScale * encounter.tier.powerMultiplier;
  const skills = template.skillKeys.map((skillKey) => {
    const definition = skillByKey.get(skillKey);
    if (!definition) throw new Error(`ENCOUNTER_SKILL_MISSING:${skillKey}`);
    return { definition, cooldownTurnsRemaining: 0 };
  });
  const maxHp = Math.max(1, Math.round(mob.stats.maxHp * healthScale));
  const maxEnergy = Math.max(1, Math.round(mob.stats.maxEnergy * Math.max(0.65, template.statScale)));
  return {
    actorId: encounterActorId(mob.id, template.key, rootKey),
    kind: 'MOB',
    name: root ? mob.name : template.name,
    characterClass: root ? mob.characterClass : template.characterClass,
    level: Math.max(1, mob.level + template.levelOffset),
    outfitKey: root ? mob.outfitKey : template.outfitKey ?? mob.outfitKey,
    renderScale: root ? mob.renderScale : template.renderScale ?? Math.max(0.4, mob.renderScale * 0.88),
    hp: maxHp,
    maxHp,
    energy: maxEnergy,
    maxEnergy,
    strength: Math.max(1, Math.round(mob.stats.strength * powerScale)),
    agility: Math.max(1, Math.round(mob.stats.agility * powerScale)),
    intelligence: Math.max(1, Math.round(mob.stats.intelligence * powerScale)),
    armor: Math.max(0, Math.round(mob.stats.armor * powerScale)),
    formationPreference: template.formation,
    fallbackAction: template.role === 'SUPPORT' ? 'DEFEND' : 'BASIC_ATTACK',
    skills,
  };
}
