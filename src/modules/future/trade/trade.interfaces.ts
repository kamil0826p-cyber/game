export type TradeLifecycleStatus =
  | 'REQUESTED'
  | 'OPEN'
  | 'LOCKED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface TradeOfferEntry {
  inventoryItemId: string;
  itemKey: string;
  quantity: number;
}

export interface TradeParticipantState {
  characterId: string;
  accepted: boolean;
  items: TradeOfferEntry[];
}

export interface TradeSessionState {
  tradeId: string;
  status: TradeLifecycleStatus;
  initiator: TradeParticipantState;
  recipient: TradeParticipantState;
  expiresAt: number;
}
