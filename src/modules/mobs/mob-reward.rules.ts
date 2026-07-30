export const MAX_MOB_EXPERIENCE_LEVEL_DIFFERENCE = 10;

export function canReceiveMobExperience(playerLevel: number, mobLevel: number): boolean {
  return Math.abs(Math.trunc(playerLevel) - Math.trunc(mobLevel)) <= MAX_MOB_EXPERIENCE_LEVEL_DIFFERENCE;
}

export function splitMobExperience(
  totalExperience: number,
  playerLevels: readonly number[],
  mobLevel: number,
): number[] {
  const shares = playerLevels.map(() => 0);
  const eligibleIndexes = playerLevels.flatMap((playerLevel, index) =>
    canReceiveMobExperience(playerLevel, mobLevel) ? [index] : [],
  );
  if (eligibleIndexes.length === 0) return shares;

  const safeTotal = Math.max(0, Math.floor(totalExperience));
  const baseExperience = Math.floor(safeTotal / eligibleIndexes.length);
  const remainder = safeTotal % eligibleIndexes.length;
  eligibleIndexes.forEach((playerIndex, eligibleIndex) => {
    shares[playerIndex] = baseExperience + (eligibleIndex < remainder ? 1 : 0);
  });
  return shares;
}
