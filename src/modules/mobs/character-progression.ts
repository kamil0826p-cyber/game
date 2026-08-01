export const MAX_CHARACTER_LEVEL = 100;

export function experienceRequiredForLevel(level: number): number {
  if (level >= MAX_CHARACTER_LEVEL) return 0;
  return Math.floor(100 * level ** 1.55 + 35 * level);
}

export interface ExperienceProgression {
  level: number;
  experience: number;
  levelsGained: number;
  nextLevelExperience: number | null;
}

export function applyExperience(
  currentLevel: number,
  currentExperience: number,
  gainedExperience: number,
): ExperienceProgression {
  let level = Math.max(1, Math.min(MAX_CHARACTER_LEVEL, Math.trunc(currentLevel)));
  let experience = Math.max(0, Math.trunc(currentExperience)) + Math.max(0, Math.trunc(gainedExperience));
  const initialLevel = level;
  while (level < MAX_CHARACTER_LEVEL) {
    const required = experienceRequiredForLevel(level);
    if (experience < required) break;
    experience -= required;
    level += 1;
  }
  if (level >= MAX_CHARACTER_LEVEL) experience = 0;
  return {
    level,
    experience,
    levelsGained: level - initialLevel,
    nextLevelExperience: level >= MAX_CHARACTER_LEVEL ? null : experienceRequiredForLevel(level),
  };
}
