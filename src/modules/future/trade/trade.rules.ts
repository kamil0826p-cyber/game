export const TRADE_INTERACTION_RADIUS = 2;
export const TRADE_REQUEST_TTL_MS = 30_000;
export const TRADE_OPEN_TTL_MS = 5 * 60_000;
export const MAX_TRADE_SILVER = 2_147_483_647;
export const MAX_TRADE_ITEM_QUANTITY = 9_999;
export const MAX_TRADE_OFFER_ITEMS = 20;

export interface TradePosition {
  mapId: string;
  x: number;
  y: number;
}

export function isTradeDistanceAllowed(
  first: TradePosition,
  second: TradePosition,
  radius = TRADE_INTERACTION_RADIUS,
): boolean {
  return first.mapId === second.mapId &&
    Math.max(Math.abs(first.x - second.x), Math.abs(first.y - second.y)) <= radius;
}

export function buildTradeLockKeys(firstCharacterId: string, secondCharacterId: string): string[] {
  return [firstCharacterId, secondCharacterId]
    .sort()
    .map((characterId) => `player-trade:${characterId}`);
}

export function isMutableTradeStatus(status: string): boolean {
  return status === 'REQUESTED' || status === 'OPEN' || status === 'LOCKED';
}
