import { z } from 'zod';
import { CHARACTER_CLASSES, DIRECTIONS } from '../common/domain/game.types.js';

const requestId = z.string().min(1).max(64);
const itemId = z.string().uuid();
const itemKey = z.string().trim().min(1).max(96);
const quantity = z.number().int().min(1).max(9999);
const tradeQuantity = z.number().int().min(0).max(9999);
const tradeId = z.string().uuid();
const characterId = z.string().uuid();
const npcId = z.string().uuid();
const dialogueIdentifier = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);
const silver = z.number().int().min(0).max(2_147_483_647);
const skillKey = z
  .string()
  .trim()
  .min(1)
  .max(96)
  .regex(/^[a-z0-9-]+$/);

export const createCharacterSchema = z.object({
  requestId,
  name: z
    .string()
    .trim()
    .min(3)
    .max(20)
    .regex(/^[A-Za-z][A-Za-z0-9 _-]*$/),
  characterClass: z.enum(CHARACTER_CLASSES),
});
export const moveStepSchema = z.object({ requestId, direction: z.enum(DIRECTIONS) });
export const moveTargetSchema = z.object({
  requestId,
  targetX: z.number().int(),
  targetY: z.number().int(),
});
export const moveStopSchema = z.object({ requestId: requestId.optional() });
export const viewportUpdateSchema = z.object({
  requestId,
  halfWidth: z.number().int().min(1).max(128),
  halfHeight: z.number().int().min(1).max(128),
});
export const chatSendSchema = z.object({
  requestId,
  channel: z.enum(['GLOBAL', 'LOCAL']),
  text: z.string().trim().min(1).max(160),
});
export const inventoryRequestSchema = z.object({ requestId });
export const inventoryItemSchema = z.object({ requestId, itemId });
export const inventoryMoveSchema = z.object({
  requestId,
  itemId,
  targetSlotIndex: z.number().int().min(0).max(39),
});
export const inventoryDiscardSchema = z.object({ requestId, itemId, quantity });
export const merchantRequestSchema = z.object({ requestId, npcId }).strict();
export const merchantBuySchema = z.object({ requestId, npcId, itemKey, quantity }).strict();
export const merchantSellSchema = z.object({ requestId, npcId, itemId, quantity }).strict();
export const npcDialogueStartSchema = z.object({ requestId, npcId }).strict();
export const npcDialogueChoiceSchema = z
  .object({ requestId, npcId, nodeId: dialogueIdentifier, choiceId: dialogueIdentifier })
  .strict();
export const npcDialogueEndSchema = z.object({ requestId, npcId }).strict();
export const tradeRequestSchema = z.object({ requestId, targetCharacterId: characterId }).strict();
export const tradeGetActiveSchema = z.object({ requestId }).strict();
export const tradeRespondSchema = z.object({ requestId, tradeId, accept: z.boolean() }).strict();
export const tradeSetItemSchema = z
  .object({ requestId, tradeId, itemId, quantity: tradeQuantity })
  .strict();
export const tradeSetSilverSchema = z.object({ requestId, tradeId, silver }).strict();
export const tradeActionSchema = z.object({ requestId, tradeId }).strict();
export const skillRequestSchema = z.object({ requestId }).strict();
export const skillUnlockSchema = z.object({ requestId, skillKey }).strict();

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
export type MerchantRequestPayload = z.infer<typeof merchantRequestSchema>;
export type MerchantBuyPayload = z.infer<typeof merchantBuySchema>;
export type MerchantSellPayload = z.infer<typeof merchantSellSchema>;
export type NpcDialogueStartPayload = z.infer<typeof npcDialogueStartSchema>;
export type NpcDialogueChoicePayload = z.infer<typeof npcDialogueChoiceSchema>;
export type NpcDialogueEndPayload = z.infer<typeof npcDialogueEndSchema>;
export type TradeRequestPayload = z.infer<typeof tradeRequestSchema>;
export type TradeGetActivePayload = z.infer<typeof tradeGetActiveSchema>;
export type TradeRespondPayload = z.infer<typeof tradeRespondSchema>;
export type TradeSetItemPayload = z.infer<typeof tradeSetItemSchema>;
export type TradeSetSilverPayload = z.infer<typeof tradeSetSilverSchema>;
export type TradeActionPayload = z.infer<typeof tradeActionSchema>;
export type SkillRequestPayload = z.infer<typeof skillRequestSchema>;
export type SkillUnlockPayload = z.infer<typeof skillUnlockSchema>;
