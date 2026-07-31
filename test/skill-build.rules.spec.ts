import { describe, expect, it } from 'vitest';
import { repairSkillBuild } from '../src/modules/skills/skill-build.rules.js';
import { skillsForClass } from '../src/modules/skills/skill.catalog.js';

describe('repairSkillBuild', () => {
  const mage = skillsForClass('MAGE');

  it('keeps a legal prerequisite chain within the point budget', () => {
    const result = repairSkillBuild(
      'MAGE',
      30,
      3,
      mage,
      mage.slice(0, 3).map((skill) => ({ key: skill.key, rank: 1 })),
    );
    expect(result.kept.map((skill) => skill.key)).toEqual(
      mage.slice(0, 3).map((skill) => skill.key),
    );
    expect(result.removed).toEqual([]);
    expect(result.spentPoints).toBe(3);
  });

  it('removes children whose prerequisite is missing', () => {
    const child = mage[1]!;
    const result = repairSkillBuild('MAGE', 100, 8, mage, [
      { key: child.key, rank: 1 },
    ]);
    expect(result.kept).toEqual([]);
    expect(result.removed).toEqual([{ key: child.key, rank: 1 }]);
  });

  it('removes skills above the character level and refunds their points', () => {
    const root = mage[0]!;
    const late = mage[mage.length - 1]!;
    const result = repairSkillBuild('MAGE', 10, 8, mage, [
      { key: root.key, rank: 1 },
      { key: late.key, rank: 1 },
    ]);
    expect(result.kept.map((skill) => skill.key)).toEqual([root.key]);
    expect(result.removed.map((skill) => skill.key)).toEqual([late.key]);
    expect(result.spentPoints).toBe(1);
  });

  it('deterministically removes later skills when the point budget shrinks', () => {
    const owned = mage.slice(0, 3).map((skill) => ({ key: skill.key, rank: 1 }));
    const first = repairSkillBuild('MAGE', 100, 2, mage, owned);
    const second = repairSkillBuild('MAGE', 100, 2, mage, [...owned].reverse());
    expect(second).toEqual(first);
    expect(first.kept).toHaveLength(2);
    expect(first.removed).toHaveLength(1);
  });

  it('caps excessive ranks and removes unknown or wrong-class definitions', () => {
    const root = mage[0]!;
    const result = repairSkillBuild('MAGE', 100, 8, mage, [
      { key: root.key, rank: 99 },
      { key: 'warrior-shield-bash', rank: 1 },
      { key: 'missing-skill', rank: 1 },
    ]);
    expect(result.kept).toEqual([{ key: root.key, rank: 1, originalRank: 99 }]);
    expect(result.removed.map((skill) => skill.key)).toEqual([
      'missing-skill',
      'warrior-shield-bash',
    ]);
  });
});
