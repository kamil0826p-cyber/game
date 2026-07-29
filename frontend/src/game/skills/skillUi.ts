import type { CombatState } from '../../contracts/game';
import type { SkillDefinitionPayload } from '../../contracts/socket';

export type SkillUseBlockReason =
  'LOCKED' | 'OUT_OF_COMBAT' | 'COOLDOWN' | 'INSUFFICIENT_ENERGY';

export const getSkillUseBlockReason = (
  skill: SkillDefinitionPayload,
  combatState: CombatState,
  currentEnergy: number,
): SkillUseBlockReason | undefined => {
  if (skill.rank < 1) return 'LOCKED';
  if (combatState !== 'IN_BATTLE') return 'OUT_OF_COMBAT';
  if (skill.cooldownTurnsRemaining > 0) return 'COOLDOWN';
  if (currentEnergy < skill.energyCost) return 'INSUFFICIENT_ENERGY';
  return undefined;
};

export const getTreePosition = (
  skill: Pick<SkillDefinitionPayload, 'treeRow' | 'treeColumn'>,
): { x: number; y: number } => ({
  x: 50 + skill.treeColumn * 27,
  y: 10 + skill.treeRow * 20,
});
