import { isActorWithinInteractionRange } from '../../../common/rules/actor-interaction.js';
import { PLAYER_INTERACTION_REQUEST_TTL_MS } from '../../../common/rules/player-interaction-request.js';
export const TRADE_REQUEST_TTL_MS = PLAYER_INTERACTION_REQUEST_TTL_MS;
export const TRADE_OPEN_TTL_MS = 5 * 60_000;
export const MAX_TRADE_SILVER = 2_147_483_647;
export const MAX_TRADE_ITEM_QUANTITY = 9_999;
export const MAX_TRADE_OFFER_ITEMS = 20;

export interface TradePosition {
  mapId: string;
  x: number;
  y: number;
}

export function isTradeDistanceAllowed(first: TradePosition, second: TradePosition): boolean {
  return isActorWithinInteractionRange(first, second);
}

export function buildTradeLockKeys(firstCharacterId: string, secondCharacterId: string): string[] {
  return [firstCharacterId, secondCharacterId]
    .sort()
    .map((characterId) => `player-trade:${characterId}`);
}

export function isMutableTradeStatus(status: string): boolean {
  return status === 'REQUESTED' || status === 'OPEN' || status === 'LOCKED';
}
