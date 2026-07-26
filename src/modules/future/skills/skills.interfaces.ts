import type { CharacterClass } from '../../../common/domain/game.types.js';

export interface SkillDefinitionContract {
  key: string;
  name: string;
  description: string;
  requiredClass?: CharacterClass;
  minimumLevel: number;
  energyCost: number;
  cooldownTurns: number;
  targeting: 'SELF' | 'ALLY' | 'ENEMY' | 'AREA';
  effectDefinition: Record<string, unknown>;
}

export interface CharacterSkillState {
  skillKey: string;
  rank: number;
  cooldownEndsAt?: number;
}
