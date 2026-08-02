import { describe, expect, it } from 'vitest';
import { pvpSettlementOperationId, splitPvpEscrow } from '../src/modules/pvp/pvp.ledger.js';

describe('PvP settlement ledger', () => {
  it('splits escrow deterministically without creating or losing silver', () => {
    const shares = splitPvpEscrow(1_001, ['char-b', 'char-a', 'char-c']);
    expect(shares).toEqual([
      { characterId: 'char-a', amountSilver: 334 },
      { characterId: 'char-b', amountSilver: 334 },
      { characterId: 'char-c', amountSilver: 333 },
    ]);
    expect(shares.reduce((sum, share) => sum + share.amountSilver, 0)).toBe(1_001);
  });

  it('deduplicates eligible winners and produces stable operation ids', () => {
    expect(splitPvpEscrow(100, ['b', 'a', 'a'])).toEqual([
      { characterId: 'a', amountSilver: 50 },
      { characterId: 'b', amountSilver: 50 },
    ]);
    expect(pvpSettlementOperationId('combat', 'character')).toBe('pvp:combat:character');
  });

  it('rejects invalid escrow amounts', () => {
    expect(() => splitPvpEscrow(-1, ['a'])).toThrow('PVP_ESCROW_AMOUNT_INVALID');
    expect(() => splitPvpEscrow(1.5, ['a'])).toThrow('PVP_ESCROW_AMOUNT_INVALID');
  });
});
