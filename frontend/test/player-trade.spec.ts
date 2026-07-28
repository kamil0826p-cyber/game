import { describe, expect, it } from 'vitest';
import { canTradeWithPlayer } from '../src/game/trade/playerTrade';
const self = { characterId: 'self', mapId: 'map-a', x: 10, y: 10 };
describe('player trade interaction', () => {
  it('allows a different player on an adjacent tile', () => { expect(canTradeWithPlayer(self, { characterId: 'other', mapId: 'map-a', x: 11, y: 11 })).toBe(true); });
  it('rejects self, another map, and a player with a one-tile gap', () => { expect(canTradeWithPlayer(self, { ...self })).toBe(false); expect(canTradeWithPlayer(self, { characterId: 'other', mapId: 'map-b', x: 10, y: 10 })).toBe(false); expect(canTradeWithPlayer(self, { characterId: 'other', mapId: 'map-a', x: 12, y: 10 })).toBe(false); });
});
