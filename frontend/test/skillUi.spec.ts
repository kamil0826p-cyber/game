import { describe, expect, it } from 'vitest';
import type { SkillDefinitionPayload } from '../src/contracts/socket';
import { getSkillUseBlockReason, getTreePosition } from '../src/game/skills/skillUi';

const skill = {
  rank: 1,
  energyCost: 20,
  cooldownTurnsRemaining: 0,
  treeRow: 2,
  treeColumn: -1,
} as SkillDefinitionPayload;

describe('skill UI rules', () => {
  it('blocks skills outside combat even when they are unlocked', () => {
    expect(getSkillUseBlockReason(skill, 'IDLE', 100)).toBe('OUT_OF_COMBAT');
  });

  it('checks unlock, cooldown, and energy before emitting a combat intent', () => {
    expect(getSkillUseBlockReason({ ...skill, rank: 0 }, 'IN_BATTLE', 100)).toBe('LOCKED');
    expect(
      getSkillUseBlockReason({ ...skill, cooldownTurnsRemaining: 2 }, 'IN_BATTLE', 100),
    ).toBe('COOLDOWN');
    expect(getSkillUseBlockReason(skill, 'IN_BATTLE', 19)).toBe('INSUFFICIENT_ENERGY');
    expect(getSkillUseBlockReason(skill, 'IN_BATTLE', 20)).toBeUndefined();
  });

  it('maps semantic tree rows and branches to stable canvas coordinates', () => {
    expect(getTreePosition(skill)).toEqual({ x: 23, y: 50 });
  });
});
