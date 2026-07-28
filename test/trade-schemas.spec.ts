import { describe, expect, it } from 'vitest';
import { tradeRequestSchema, tradeSetItemSchema, tradeSetSilverSchema } from '../src/contracts/socket.schemas.js';
const requestId = 'request-1';
const tradeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const itemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const targetCharacterId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
describe('trade socket schemas', () => {
  it('accepts a valid request', () => { expect(tradeRequestSchema.parse({ requestId, targetCharacterId })).toEqual({ requestId, targetCharacterId }); });
  it('accepts zero quantity to remove an item', () => { expect(tradeSetItemSchema.parse({ requestId, tradeId, itemId, quantity: 0 }).quantity).toBe(0); });
  it.each([-1, 10_000, 1.5])('rejects unsafe quantity %s', (quantity) => { expect(() => tradeSetItemSchema.parse({ requestId, tradeId, itemId, quantity })).toThrow(); });
  it('accepts silver only', () => { expect(tradeSetSilverSchema.parse({ requestId, tradeId, silver: 2_147_483_647 }).silver).toBe(2_147_483_647); expect(() => tradeSetSilverSchema.parse({ requestId, tradeId, silver: 2_147_483_648 })).toThrow(); expect(() => tradeSetSilverSchema.parse({ requestId, tradeId, gold: 1 })).toThrow(); });
});
