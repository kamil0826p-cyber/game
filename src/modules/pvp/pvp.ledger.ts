export interface PvpEscrowShare {
  characterId: string;
  amountSilver: number;
}

export function splitPvpEscrow(
  amountSilver: number,
  eligibleCharacterIds: readonly string[],
): readonly PvpEscrowShare[] {
  if (!Number.isInteger(amountSilver) || amountSilver < 0) {
    throw new RangeError('PVP_ESCROW_AMOUNT_INVALID');
  }
  const unique = [...new Set(eligibleCharacterIds)].sort((left, right) => left.localeCompare(right));
  if (unique.length === 0 || amountSilver === 0) return [];
  const base = Math.floor(amountSilver / unique.length);
  let remainder = amountSilver - base * unique.length;
  return unique.map((characterId) => {
    const amount = base + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
    return { characterId, amountSilver: amount };
  });
}

export function pvpSettlementOperationId(combatId: string, characterId: string): string {
  return `pvp:${combatId}:${characterId}`;
}
