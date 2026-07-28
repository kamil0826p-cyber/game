import { z } from 'zod';
import { CHARACTER_CLASSES, DIRECTIONS } from '../common/domain/game.types.js';

const requestId = z.string().min(1).max(64);
const itemId = z.string().uuid();
const itemKey = z.string().trim().min(1).max(96);
const quantity = z.number().int().min(1).max(9999);
const tradeId = z.string().uuid();

export const createCharacterSchema = z.object({
  requestId,
  name: z.string().trim().min(3).max(20).regex(/^[A-Za-z][A-Za-z0-9 _-]*$/),
  characterClass: z.enum(CHARACTER_CLASSES),
});
export const moveStepSchema = z.object({ requestId, direction: z.enum(DIRECTIONS) });
export const moveTargetSchema = z.object({ requestId, targetX: z.number().int(), targetY: z.number().int() });
export const moveStopSchema = z.object({ requestId: requestId.optional() });
export const viewportUpdateSchema = z.object({ requestId, halfWidth: z.number().int().min(1).max(128), halfHeight: z.number().int().min(1).max(128) });
export const chatSendSchema = z.object({ requestId, channel: z.enum(['GLOBAL', 'LOCAL']), text: z.string().trim().min(1).max(160) });
export const inventoryRequestSchema = z.object({ requestId });
export const inventoryItemSchema = z.object({ requestId, itemId });
export const inventoryMoveSchema = z.object({ requestId, itemId, targetSlotIndex: z.number().int().min(0).max(39) });
export const inventoryDiscardSchema = z.object({ requestId, itemId, quantity });
export const merchantBuySchema = z.object({ requestId, itemKey, quantity });
export const merchantSellSchema = z.object({ requestId, itemId, quantity });
export const tradeRequestSchema = z.object({ requestId, targetCharacterId: z.string().uuid() });
export const tradeRespondSchema = z.object({ requestId, tradeId, accept: z.boolean() });
export const tradeOfferSchema = z.object({
  requestId,
  tradeId,
  silver: z.number().int().min(0).max(2_000_000_000),
  items: z.array(z.object({ itemId, quantity })).max(40),
});
export const tradeConfirmSchema = z.object({ requestId, tradeId });
export const tradeCancelSchema = z.object({ requestId, tradeId });

export type CreateCharacterPayload = z.infer<typeof createCharacterSchema>;
export type MoveStepPayload = z.infer<typeof moveStepSchema>;
export type MoveTargetPayload = z.infer<typeof moveTargetSchema>;
export type MoveStopPayload = z.infer<typeof moveStopSchema>;
export type ViewportUpdatePayload = z.infer<typeof viewportUpdateSchema>;
export type ChatSendPayload = z.infer<typeof chatSendSchema>;
export type InventoryRequestPayload = z.infer<typeof inventoryRequestSchema>;
export type InventoryItemPayload = z.infer<typeof inventoryItemSchema>;
export type InventoryMovePayload = z.infer<typeof inventoryMoveSchema>;
export type InventoryDiscardPayload = z.infer<typeof inventoryDiscardSchema>;
export type MerchantBuyPayload = z.infer<typeof merchantBuySchema>;
export type MerchantSellPayload = z.infer<typeof merchantSellSchema>;
export type TradeRequestPayload = z.infer<typeof tradeRequestSchema>;
export type TradeRespondPayload = z.infer<typeof tradeRespondSchema>;
export type TradeOfferPayload = z.infer<typeof tradeOfferSchema>;
export type TradeConfirmPayload = z.infer<typeof tradeConfirmSchema>;
export type TradeCancelPayload = z.infer<typeof tradeCancelSchema>;
