import { describe, expect, it } from 'vitest';
import { CHARACTER_CLASSES } from '../src/common/domain/game.types.js';
import { SKILL_CATALOG, skillsForClass } from '../src/modules/skills/skill.catalog.js';

describe('combat skill catalog', () => {
  it('defines exactly eight unique combat skills for every character class', () => {
    expect(SKILL_CATALOG).toHaveLength(24);
    expect(new Set(SKILL_CATALOG.map((skill) => skill.key)).size).toBe(24);

    for (const characterClass of CHARACTER_CLASSES) {
      const skills = skillsForClass(characterClass);
      expect(skills).toHaveLength(8);
      expect(skills.map((skill) => skill.displayOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    }
  });

  it('has an acyclic, class-local prerequisite graph ordered from root to capstone', () => {
    const byKey = new Map(SKILL_CATALOG.map((skill) => [skill.key, skill]));

    for (const skill of SKILL_CATALOG) {
      for (const prerequisiteKey of skill.prerequisiteKeys) {
        const prerequisite = byKey.get(prerequisiteKey);
        expect(prerequisite, `${skill.key} has a missing prerequisite`).toBeDefined();
        expect(prerequisite?.characterClass).toBe(skill.characterClass);
        expect(prerequisite?.displayOrder).toBeLessThan(skill.displayOrder);
      }
    }

    for (const characterClass of CHARACTER_CLASSES) {
      const skills = skillsForClass(characterClass);
      expect(skills[0]?.prerequisiteKeys).toEqual([]);
      expect(skills[7]?.prerequisiteKeys).toHaveLength(2);
    }
  });

  it('contains turn-based effects and stable animation hooks for future combat rendering', () => {
    for (const skill of SKILL_CATALOG) {
      expect(skill.minimumLevel).toBeGreaterThanOrEqual(10);
      expect(skill.energyCost).toBeGreaterThan(0);
      expect(skill.cooldownTurns).toBeGreaterThanOrEqual(0);
      expect(skill.effects.length).toBeGreaterThan(0);
      expect(skill.animationKey).toMatch(/^[a-z]+-[a-z0-9-]+$/);
      expect(skill.visual.castEffectKey).toContain(skill.animationKey);
      expect(skill.visual.impactEffectKey).toContain(skill.animationKey);
    }
  });
});
