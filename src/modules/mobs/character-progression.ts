export const MAX_CHARACTER_LEVEL = 100;

export function experienceRequiredForLevel(level: number): number {
  const safeLevel = Math.max(1, Math.min(MAX_CHARACTER_LEVEL, Math.floor(level)));
  return Math.floor(100 * safeLevel ** 1.55 + 35 * safeLevel);
}

export interface ProgressionResult {
  level: number;
  experience: number;
  levelsGained: number;
  nextLevelExperience: number | null;
}

export function applyExperience(currentLevel: number, currentExperience: number, gained: number): ProgressionResult {
  let level = Math.max(1, Math.min(MAX_CHARACTER_LEVEL, Math.floor(currentLevel)));
  let experience = Math.max(0, Math.floor(currentExperience)) + Math.max(0, Math.floor(gained));
  let levelsGained = 0;

  while (level < MAX_CHARACTER_LEVEL) {
    const required = experienceRequiredForLevel(level);
    if (experience < required) break;
    experience -= required;
    level += 1;
    levelsGained += 1;
  }

  if (level === MAX_CHARACTER_LEVEL) experience = 0;

  return {
    level,
    experience,
    levelsGained,
    nextLevelExperience: level < MAX_CHARACTER_LEVEL ? experienceRequiredForLevel(level) : null,
  };
}

export function statGrowthForLevels(levelsGained: number): {
  maxHp: number;
  maxEnergy: number;
  strength: number;
  agility: number;
  intelligence: number;
  armor: number;
} {
  const levels = Math.max(0, Math.floor(levelsGained));
  return {
    maxHp: levels * 12,
    maxEnergy: levels * 4,
    strength: levels * 2,
    agility: levels * 2,
    intelligence: levels * 2,
    armor: levels,
  };
}
