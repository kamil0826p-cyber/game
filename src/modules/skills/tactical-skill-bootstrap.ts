import type { CombatEffectOperation, SkillCatalogDefinition } from './skill.types.js';
import { SKILL_CATALOG } from './skill.catalog.js';

export const TACTICAL_SKILL_RULESET_VERSION = 1;

type MutableSkill = Omit<SkillCatalogDefinition, 'effects' | 'prerequisiteKeys'> & {
  effects: CombatEffectOperation[];
  prerequisiteKeys: string[];
};

const mutableCatalog = SKILL_CATALOG as unknown as MutableSkill[];

function requireSkill(key: string): MutableSkill {
  const skill = mutableCatalog.find((candidate) => candidate.key === key);
  if (!skill) throw new Error(`Tactical skill rules reference missing skill ${key}.`);
  return skill;
}

function damageEffect(skill: MutableSkill): Extract<CombatEffectOperation, { type: 'DAMAGE' }> {
  const effect = skill.effects.find(
    (candidate): candidate is Extract<CombatEffectOperation, { type: 'DAMAGE' }> =>
      candidate.type === 'DAMAGE',
  );
  if (!effect) throw new Error(`Tactical finisher ${skill.key} has no damage effect.`);
  return effect;
}

function configureTelegraph(
  key: string,
  publicIntent: string,
  counters: Array<'INTERRUPT' | 'GUARD' | 'INTERCEPT' | 'CLEANSE'>,
): void {
  const skill = requireSkill(key);
  skill.telegraph = {
    reactionWindowMs: 4_000,
    publicIntent,
    interruptible: counters.includes('INTERRUPT'),
    counters,
  };
}

// Heavy skills expose their intent and can be answered without creating a second combat system.
configureTelegraph(
  'mage-meteor',
  'Meteor uderzy całą drużynę. Przerwij rzucanie albo osłoń zagrożonych sojuszników.',
  ['INTERRUPT', 'GUARD', 'INTERCEPT'],
);
configureTelegraph(
  'mage-elemental-cataclysm',
  'Kataklizm obejmie wszystkich przeciwników i nałoży efekty żywiołów.',
  ['INTERRUPT', 'GUARD', 'INTERCEPT', 'CLEANSE'],
);
configureTelegraph(
  'warrior-unbreakable-assault',
  'Wojownik szarżuje przez przednią linię.',
  ['GUARD', 'INTERCEPT'],
);
configureTelegraph(
  'archer-rain-of-arrows',
  'Deszcz strzał spadnie na całą drużynę.',
  ['INTERRUPT', 'GUARD', 'INTERCEPT'],
);

// Existing AREA remains accepted as a legacy alias; production definitions use explicit scopes.
requireSkill('mage-frost-nova').targeting = 'ALL_ENEMIES';
requireSkill('mage-meteor').targeting = 'ALL_ENEMIES';
requireSkill('mage-elemental-cataclysm').targeting = 'ALL_ENEMIES';
requireSkill('warrior-cleave').targeting = 'FRONT_ROW';
requireSkill('warrior-whirlwind').targeting = 'ALL_ENEMIES';
requireSkill('warrior-unbreakable-assault').targeting = 'FRONT_ROW';
requireSkill('archer-volley').targeting = 'ALL_ENEMIES';
requireSkill('archer-rain-of-arrows').targeting = 'ALL_ENEMIES';
requireSkill('warrior-battle-cry').targeting = 'ALL_ALLIES';

// Synergy 1: Predator's Mark creates both a general vulnerability and an EXPOSED setup.
const predatorMark = requireSkill('archer-predators-mark');
predatorMark.effects.push({
  type: 'APPLY_STATUS',
  statusKey: 'EXPOSED',
  durationTurns: 3,
  harmful: true,
});

// Synergy 2: warrior Execution consumes EXPOSED for an additional coefficient.
damageEffect(requireSkill('warrior-execution')).consumesStatusKey = 'EXPOSED';

// Synergy 3: Perfect Hunt consumes the long mark instead of passively stacking forever.
damageEffect(requireSkill('archer-perfect-hunt')).consumesStatusKey = 'DAMAGE_TAKEN_INCREASE';

// Hard-control metadata drives the shared PvP diminishing-return path.
for (const skill of mutableCatalog) {
  for (const effect of skill.effects) {
    if (effect.type === 'APPLY_STATUS' && effect.statusKey === 'STUNNED') {
      effect.harmful = true;
      effect.hardControl = true;
    }
    if (
      effect.type === 'APPLY_STATUS' &&
      ['BURN', 'BLEED', 'ROOTED', 'SLOWED', 'DAMAGE_TAKEN_INCREASE', 'EXPOSED'].includes(
        effect.statusKey,
      )
    ) {
      effect.harmful = true;
    }
  }
}
