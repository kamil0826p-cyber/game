import type { InventorySnapshot, TradeLifecycleStatus, TradeOfferItemPayload } from '../../../contracts/socket.events.js';

export interface TradeParticipantState {
  characterId: string;
  name: string;
  accepted: boolean;
  silver: number;
  items: TradeOfferItemPayload[];
}

export interface TradeSessionState {
  tradeId: string;
  status: TradeLifecycleStatus;
  initiator: TradeParticipantState;
  recipient: TradeParticipantState;
  inventory: InventorySnapshot;
  expiresAt: number;
}
