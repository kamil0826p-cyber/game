import { z } from 'zod';

const requestIdSchema = z.string().trim().min(1).max(64);
const characterIdSchema = z.string().trim().min(1).max(128);
const inviteIdSchema = z.string().uuid();

export const groupGetSchema = z.object({ requestId: requestIdSchema }).strict();
export const groupInviteSchema = z
  .object({ requestId: requestIdSchema, targetCharacterId: characterIdSchema })
  .strict();
export const groupRespondSchema = z
  .object({ requestId: requestIdSchema, inviteId: inviteIdSchema, accept: z.boolean() })
  .strict();
export const groupLeaveSchema = z.object({ requestId: requestIdSchema }).strict();
export const groupKickSchema = z
  .object({ requestId: requestIdSchema, targetCharacterId: characterIdSchema })
  .strict();

export type GroupGetPayload = z.infer<typeof groupGetSchema>;
export type GroupInviteCommandPayload = z.infer<typeof groupInviteSchema>;
export type GroupRespondPayload = z.infer<typeof groupRespondSchema>;
export type GroupLeavePayload = z.infer<typeof groupLeaveSchema>;
export type GroupKickPayload = z.infer<typeof groupKickSchema>;
