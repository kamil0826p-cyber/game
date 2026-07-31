import { Injectable } from '@nestjs/common';
import type { CharacterClass } from '../../common/domain/game.types.js';
import { GameConfigService } from '../../config/game-config.service.js';
import {
  applyExperience,
  calculateBaseStats,
  calculateSkillPointBudget,
  experienceRequiredForNextLevel,
  requireProgressionRuleset,
  type ExperienceApplicationResult,
  type ProgressionRuleset,
  type ProgressionStats,
} from './progression.rules.js';

@Injectable()
export class ProgressionService {
  readonly ruleset: ProgressionRuleset;
  readonly maximumLevel: number;

  constructor(config: GameConfigService) {
    this.ruleset = requireProgressionRuleset(config.values.PROGRESSION_RULESET_VERSION);
    this.maximumLevel = config.values.MAX_CHARACTER_LEVEL;
  }

  calculateBaseStats(characterClass: CharacterClass, level: number): ProgressionStats {
    return calculateBaseStats(characterClass, this.clampLevel(level), this.ruleset);
  }

  applyExperience(
    currentLevel: number,
    currentExperience: number,
    awardedExperience: number,
  ): ExperienceApplicationResult {
    return applyExperience(
      currentLevel,
      currentExperience,
      awardedExperience,
      this.maximumLevel,
      this.ruleset,
    );
  }

  experienceRequiredForNextLevel(level: number): number | null {
    const safeLevel = this.clampLevel(level);
    return safeLevel >= this.maximumLevel
      ? null
      : experienceRequiredForNextLevel(safeLevel, this.ruleset);
  }

  calculateSkillPointBudget(
    level: number,
    spent: number,
    capacity: number,
  ): { earned: number; spent: number; available: number; nextPointAtLevel?: number } {
    return calculateSkillPointBudget(
      this.clampLevel(level),
      spent,
      capacity,
      this.ruleset,
    );
  }

  clampLevel(level: number): number {
    return Math.min(this.maximumLevel, Math.max(1, Math.trunc(level)));
  }
}
