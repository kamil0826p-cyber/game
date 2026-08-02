import { z } from 'zod';
import {
  CHARACTER_CLASSES,
  CHARACTER_GENDERS,
  DIRECTIONS,
} from '../common/domain/game.types.js';

const requestId = z.string().min(1).max(64);
const operationId = z.string().min(1).max(96);
const itemId = z.string().uuid();
const itemKey = z.string().trim().min(1).max(96);
const quantity = z.number().int().min(1).max(9999);
const tradeQuantity = z.number().int().min(0).max(9999);
const tradeId = z.string().uuid();
const combatId = z.string().uuid();
const characterId = z.string().uuid();
const actorId = z.string().trim().min(1).max(128);
const npcId = z.string().uuid();
const inviteId = z.string().uuid();
const outfitKey = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9-]+$/);
const dialogueIdentifier = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);
const silver = z.number().int().min(0).max(2_147_483_647);
const guildTreasuryAmount = z.number().int().min(1).max(2_000_000_000);
const skillKey = z
  .string()
  .trim()
  .min(1)
  .max(96)
  .regex(/^[a-z0-9-]+$/);
const combatOperation = {
  operationId: operationId.optional(),
  expectedTurnNumber: z.number().int().min(1).optional(),
  contractVersion: z.literal(2).optional(),
};

export const createCharacterSchema = z
  .object({
    requestId,
    name: z
      .string()
      .trim()
      .min(3)
      .max(20)
      .regex(/^[A-Za-z][A-Za-z0-9 _-]*$/),
    characterClass: z.enum(CHARACTER_CLASSES),
    gender: z.enum(CHARACTER_GENDERS).default('MALE'),
    outfitKey: outfitKey.optional(),
  })
  .strict();
export const selectCharacterSchema = z.object({ requestId, characterId }).strict();
export const updateCharacterOutfitSchema = z
  .object({ requestId, characterId, outfitKey })
  .strict();
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
export const guildChatSchema = z
  .object({ requestId, text: z.string().trim().min(1).max(160) })
  .strict();
export const inventoryRequestSchema = z.object({ requestId });
export const inventoryItemSchema = z.object({ requestId, itemId });
export const inventoryMoveSchema = z.object({
  requestId,
  itemId,
  targetSlotIndex: z.number().int().min(0).max(39),
});
export const inventoryDestroySchema = z.object({ requestId, itemId, quantity });
export const merchantRequestSchema = z.object({ requestId, npcId }).strict();
export const merchantBuySchema = z
  .object({ requestId, npcId, itemKey, quantity })
  .strict();
export const merchantSellSchema = z
  .object({ requestId, npcId, itemId, quantity })
  .strict();
export const npcDialogueStartSchema = z.object({ requestId, npcId }).strict();
export const npcDialogueChoiceSchema = z
  .object({
    requestId,
    npcId,
    nodeId: dialogueIdentifier,
    choiceId: dialogueIdentifier,
  })
  .strict();
export const npcDialogueEndSchema = z.object({ requestId, npcId }).strict();
export const tradeRequestSchema = z
  .object({ requestId, targetCharacterId: characterId })
  .strict();
export const tradeGetActiveSchema = z.object({ requestId }).strict();
export const tradeRespondSchema = z
  .object({ requestId, tradeId, accept: z.boolean() })
  .strict();
export const tradeSetItemSchema = z
  .object({ requestId, tradeId, itemId, quantity: tradeQuantity })
  .strict();
export const tradeSetSilverSchema = z
  .object({ requestId, tradeId, silver })
  .strict();
export const tradeActionSchema = z.object({ requestId, tradeId }).strict();
export const skillRequestSchema = z.object({ requestId }).strict();
export const skillUnlockSchema = z.object({ requestId, skillKey }).strict();
export const combatGetActiveSchema = z.object({ requestId }).strict();
export const combatRequestSchema = z
  .object({ requestId, targetCharacterId: characterId })
  .strict();
export const combatRespondSchema = z
  .object({ requestId, combatId, accept: z.boolean() })
  .strict();
export const combatActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      requestId,
      combatId,
      action: z.literal('BASIC_ATTACK'),
      targetActorId: actorId.optional(),
      ...combatOperation,
    })
    .strict(),
  z
    .object({
      requestId,
      combatId,
      action: z.literal('SKILL'),
      skillKey,
      targetActorId: actorId.optional(),
      ...combatOperation,
    })
    .strict(),
  z
    .object({
      requestId,
      combatId,
      action: z.enum([
        'DEFEND',
        'INTERCEPT',
        'TAUNT',
        'INTERRUPT',
        'CLEANSE',
        'MARK',
        'COUNTER',
        'REPOSITION',
        'TRANSFER_ENERGY',
        'SKIP',
      ]),
      targetActorId: actorId.optional(),
      ...combatOperation,
    })
    .strict(),
]);
export const combatLeaveSchema = z.object({ requestId, combatId }).strict();
export const guildGetSchema = z.object({ requestId }).strict();
export const guildCreateSchema = z
  .object({
    requestId,
    name: z.string().trim().min(3).max(32),
    tag: z.string().trim().min(2).max(5),
    description: z.string().max(280).default(''),
  })
  .strict();
export const guildInviteSchema = z
  .object({ requestId, characterName: z.string().trim().min(3).max(24) })
  .strict();
export const guildRespondSchema = z
  .object({ requestId, inviteId, accept: z.boolean() })
  .strict();
export const guildUpdateDescriptionSchema = z
  .object({ requestId, description: z.string().max(280) })
  .strict();
export const guildSetRoleSchema = z
  .object({
    requestId,
    targetCharacterId: characterId,
    role: z.enum(['OFFICER', 'MEMBER']),
  })
  .strict();
export const guildKickSchema = z
  .object({ requestId, targetCharacterId: characterId })
  .strict();
export const guildLeaveSchema = z.object({ requestId }).strict();
export const guildTransferLeadershipSchema = z
  .object({ requestId, targetCharacterId: characterId })
  .strict();
export const guildDisbandSchema = z.object({ requestId }).strict();
export const guildDepositSchema = z
  .object({ requestId, amount: guildTreasuryAmount })
  .strict();
export const guildWithdrawSchema = z
  .object({ requestId, amount: guildTreasuryAmount })
  .strict();
export const guildBuyExperienceUpgradeSchema = z.object({ requestId }).strict();

export type CreateCharacterPayload = z.infer<typeof createCharacterSchema>;
export type SelectCharacterPayload = z.infer<typeof selectCharacterSchema>;
export type UpdateCharacterOutfitPayload = z.infer<
  typeof updateCharacterOutfitSchema
>;
export type MoveStepPayload = z.infer<typeof moveStepSchema>;
export type MoveTargetPayload = z.infer<typeof moveTargetSchema>;
export type MoveStopPayload = z.infer<typeof moveStopSchema>;
export type ViewportUpdatePayload = z.infer<typeof viewportUpdateSchema>;
export type ChatSendPayload = z.infer<typeof chatSendSchema>;
export type GuildChatPayload = z.infer<typeof guildChatSchema>;
export type InventoryRequestPayload = z.infer<typeof inventoryRequestSchema>;
export type InventoryItemPayload = z.infer<typeof inventoryItemSchema>;
export type InventoryMovePayload = z.infer<typeof inventoryMoveSchema>;
export type InventoryDestroyPayload = z.infer<typeof inventoryDestroySchema>;
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
export type CombatGetActivePayload = z.infer<typeof combatGetActiveSchema>;
export type CombatRequestPayload = z.infer<typeof combatRequestSchema>;
export type CombatRespondPayload = z.infer<typeof combatRespondSchema>;
export type CombatActionPayload = z.infer<typeof combatActionSchema>;
export type CombatLeavePayload = z.infer<typeof combatLeaveSchema>;
export type GuildGetPayload = z.infer<typeof guildGetSchema>;
export type GuildCreatePayload = z.infer<typeof guildCreateSchema>;
export type GuildInviteCommandPayload = z.infer<typeof guildInviteSchema>;
export type GuildRespondPayload = z.infer<typeof guildRespondSchema>;
export type GuildUpdateDescriptionPayload = z.infer<
  typeof guildUpdateDescriptionSchema
>;
export type GuildSetRolePayload = z.infer<typeof guildSetRoleSchema>;
export type GuildKickPayload = z.infer<typeof guildKickSchema>;
export type GuildLeavePayload = z.infer<typeof guildLeaveSchema>;
export type GuildTransferLeadershipPayload = z.infer<
  typeof guildTransferLeadershipSchema
>;
export type GuildDisbandPayload = z.infer<typeof guildDisbandSchema>;
export type GuildDepositPayload = z.infer<typeof guildDepositSchema>;
export type GuildWithdrawPayload = z.infer<typeof guildWithdrawSchema>;
export type GuildBuyExperienceUpgradePayload = z.infer<
  typeof guildBuyExperienceUpgradeSchema
>;
