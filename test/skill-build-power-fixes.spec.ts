import { describe, expect, it } from 'vitest';
import '../src/modules/skills/skill.buildcraft.power-fixes.js';
import { findSkillBuildNode } from '../src/modules/skills/skill.buildcraft.catalog.js';
import { resolveSkillDefinition } from '../src/modules/skills/skill.buildcraft.rules.js';

const resolvedWith = (skillKey: string, nodeKey: string) =>
  resolveSkillDefinition({
    skillKey,
    activeRank: 1,
    passiveNodeKeys: [nodeKey],
    ranks: { [skillKey]: 1, [nodeKey]: 1 },
  });

describe('skill build power fixes', () => {
  it.each([
    ['mage-arcanist-fractured-ray', 'mage-arcane-spark'],
    ['warrior-vanguard-linebreaker', 'warrior-shield-bash'],
    ['archer-sharpshooter-backline', 'archer-quick-shot'],
  ])('%s keeps a single enemy target and applies its damage bonus', (nodeKey, skillKey) => {
    const node = findSkillBuildNode(nodeKey);
    const resolved = resolvedWith(skillKey, nodeKey);

    expect(node?.modifiersByRank?.[0]?.[0]).toMatchObject({
      type: 'SCALE_EFFECT',
      effectType: 'DAMAGE',
      multiplier: 1.08,
    });
    expect(resolved?.targeting).toBe('ENEMY');
    expect(
      resolved?.effects[0]?.type === 'DAMAGE'
        ? resolved.effects[0].coefficient
        : undefined,
    ).toBe(1.08);
  });

  it('keeps Predator’s Mark single-target and strengthens only its vulnerability', () => {
    const nodeKey = 'archer-pathfinder-back-mark';
    const node = findSkillBuildNode(nodeKey);
    const resolved = resolvedWith('archer-predators-mark', nodeKey);
    const status = resolved?.effects.find((effect) => effect.type === 'APPLY_STATUS');

    expect(node?.modifiersByRank?.[0]?.[0]).toMatchObject({
      type: 'SCALE_EFFECT',
      effectType: 'APPLY_STATUS',
      multiplier: 1.15,
    });
    expect(resolved?.targeting).toBe('ENEMY');
    expect(status?.type === 'APPLY_STATUS' ? status.magnitude : undefined).toBe(0.23);
  });

  it('preserves intentional whole-row conversions for original area skills', () => {
    expect(
      resolvedWith('mage-frost-nova', 'mage-cryomancer-front-nova')?.targeting,
    ).toBe('FRONT_ROW');
    expect(
      resolvedWith('warrior-whirlwind', 'warrior-berserker-front-whirlwind')
        ?.targeting,
    ).toBe('FRONT_ROW');
  });
});
