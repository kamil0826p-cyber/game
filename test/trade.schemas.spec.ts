import { describe, expect, it } from 'vitest';
import { tradeOfferSchema, tradeRequestSchema, tradeRespondSchema } from '../src/contracts/socket.schemas.js';

const requestId = 'req-1';
const tradeId = '11111111-1111-4111-8111-111111111111';
const characterId = '22222222-2222-4222-8222-222222222222';
const itemId = '33333333-3333-4333-8333-333333333333';

describe('player trade socket schemas', () => {
  it('accepts a player trade request payload', () => {
    expect(tradeRequestSchema.parse({ requestId, targetCharacterId: characterId })).toEqual({ requestId, targetCharacterId: characterId });
  });

  it('accepts an explicit request decision', () => {
    expect(tradeRespondSchema.parse({ requestId, tradeId, accept: true }).accept).toBe(true);
  });

  it('rejects negative silver and duplicate item ids', () => {
    expect(tradeOfferSchema.safeParse({ requestId, tradeId, silver: -1, items: [] }).success).toBe(false);
    expect(tradeOfferSchema.safeParse({ requestId, tradeId, silver: 10, items: [{ itemId, quantity: 1 }, { itemId, quantity: 1 }] }).success).toBe(false);
  });

  it('rejects zero quantities and unsafe silver values', () => {
    expect(tradeOfferSchema.safeParse({ requestId, tradeId, silver: Number.MAX_SAFE_INTEGER, items: [] }).success).toBe(false);
    expect(tradeOfferSchema.safeParse({ requestId, tradeId, silver: 0, items: [{ itemId, quantity: 0 }] }).success).toBe(false);
  });

  it('does not expose a gold field in the parsed offer', () => {
    const result = tradeOfferSchema.parse({ requestId, tradeId, silver: 0, gold: 100, items: [] });
    expect('gold' in result).toBe(false);
  });
});
