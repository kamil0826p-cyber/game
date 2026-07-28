import { describe, expect, it } from 'vitest';
import { buildTradeLockKeys, isMutableTradeStatus, isTradeDistanceAllowed, MAX_TRADE_OFFER_ITEMS, MAX_TRADE_SILVER } from '../src/modules/player/trade/trade.rules.js';

describe('trade rules', () => {
  it('allows nearby players on the same map', () => { expect(isTradeDistanceAllowed({ mapId: 'map-a', x: 10, y: 10 }, { mapId: 'map-a', x: 12, y: 8 })).toBe(true); });
  it('rejects distant players and players on another map', () => { expect(isTradeDistanceAllowed({ mapId: 'map-a', x: 10, y: 10 }, { mapId: 'map-a', x: 13, y: 10 })).toBe(false); expect(isTradeDistanceAllowed({ mapId: 'map-a', x: 10, y: 10 }, { mapId: 'map-b', x: 10, y: 10 })).toBe(false); });
  it('locks participants in deterministic order', () => { expect(buildTradeLockKeys('character-b', 'character-a')).toEqual(['player-trade:character-a', 'player-trade:character-b']); });
  it.each(['REQUESTED', 'OPEN', 'LOCKED'])('recognizes mutable status %s', (status) => { expect(isMutableTradeStatus(status)).toBe(true); });
  it.each(['COMPLETED', 'CANCELLED', 'EXPIRED'])('rejects terminal status %s', (status) => { expect(isMutableTradeStatus(status)).toBe(false); });
  it('keeps offer and silver limits bounded', () => { expect(MAX_TRADE_OFFER_ITEMS).toBe(20); expect(MAX_TRADE_SILVER).toBe(2_147_483_647); });
});
