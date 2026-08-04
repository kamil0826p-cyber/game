import { SKILL_BUILD_CATALOG } from './skill.buildcraft.catalog.js';
import type { SkillModifierOperation } from './skill.buildcraft.types.js';

interface SkillBuildPowerFix {
  name?: string;
  description: string;
  operation: SkillModifierOperation;
}

const SKILL_BUILD_POWER_FIXES: Readonly<Record<string, SkillBuildPowerFix>> = {
  'mage-arcanist-fractured-ray': {
    name: 'Focused Ray',
    description:
      'Arcane Spark zachowuje pojedynczy cel i zadaje o 8% więcej obrażeń.',
    operation: {
      version: 1,
      type: 'SCALE_EFFECT',
      effectType: 'DAMAGE',
      multiplier: 1.08,
    },
  },
  'warrior-vanguard-linebreaker': {
    description:
      'Shield Bash zachowuje pojedynczy cel i zadaje o 8% więcej obrażeń.',
    operation: {
      version: 1,
      type: 'SCALE_EFFECT',
      effectType: 'DAMAGE',
      multiplier: 1.08,
    },
  },
  'archer-sharpshooter-backline': {
    description:
      'Quick Shot zachowuje pojedynczy cel i zadaje o 8% więcej obrażeń.',
    operation: {
      version: 1,
      type: 'SCALE_EFFECT',
      effectType: 'DAMAGE',
      multiplier: 1.08,
    },
  },
  'archer-pathfinder-back-mark': {
    description:
      'Predator’s Mark zachowuje pojedynczy cel i zwiększa siłę podatności o 15%.',
    operation: {
      version: 1,
      type: 'SCALE_EFFECT',
      effectType: 'APPLY_STATUS',
      multiplier: 1.15,
    },
  },
};

export const applySkillBuildPowerFixes = (): void => {
  for (const [nodeKey, fix] of Object.entries(SKILL_BUILD_POWER_FIXES)) {
    const node = SKILL_BUILD_CATALOG.nodes.find((candidate) => candidate.key === nodeKey);
    if (!node || node.kind !== 'MODIFIER' || node.maxRank !== 1) {
      throw new Error(`SKILL_BUILD_POWER_FIX_TARGET_INVALID:${nodeKey}`);
    }
    if (fix.name) node.name = fix.name;
    node.description = fix.description;
    node.modifiersByRank = [[fix.operation]];
  }
};

applySkillBuildPowerFixes();
