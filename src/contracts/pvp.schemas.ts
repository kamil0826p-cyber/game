import { z } from 'zod';

export const PVP_MODE_KEYS = [
  'DUEL_1V1',
  'SKIRMISH_2V2',
  'SKIRMISH_3V3',
  'WARPARTY_5V5',
  'WARHOST_10V10',
  'CONTROL_RITUAL_5V5',
  'RELIC_HOLD_10V10',
] as const;

export const PVP_ENGAGEMENT_KINDS = [
  'DUEL',
  'OPEN_WORLD',
  'BOUNTY',
  'RANKED',
  'OBJECTIVE',
] as const;

const requestId = z.string().min(1).max(64);
const characterId = z.string().uuid();
const combatId = z.string().uuid();
const bountyId = z.string().uuid();
const operationId = z.string().min(8).max(96).regex(/^[A-Za-z0-9:_-]+$/);
const modeKey = z.enum(PVP_MODE_KEYS);

export const pvpGetSchema = z.object({ requestId }).strict();
export const pvpSetOptInSchema = z.object({ requestId, optedIn: z.boolean() }).strict();
export const pvpRedeemSchema = z
  .object({ requestId, operationId, points: z.number().int().min(1).max(20) })
  .strict();
export const pvpEngageSchema = z
  .object({
    requestId,
    targetCharacterId: characterId,
    kind: z.enum(PVP_ENGAGEMENT_KINDS),
    modeKey: modeKey.optional(),
    bountyId: bountyId.optional(),
    normalized: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === 'BOUNTY' && !value.bountyId) {
      context.addIssue({ code: 'custom', path: ['bountyId'], message: 'Bounty engagement requires bountyId' });
    }
    if ((value.kind === 'RANKED' || value.kind === 'OBJECTIVE') && !value.modeKey) {
      context.addIssue({ code: 'custom', path: ['modeKey'], message: 'Queued engagement requires modeKey' });
    }
  });
export const pvpNormalizationPreviewSchema = z
  .object({
    requestId,
    modeKey,
    level: z.number().int().min(1).max(200),
    stats: z.object({
      maxHp: z.number().int().positive().max(2_147_483_647),
      maxEnergy: z.number().int().nonnegative().max(2_147_483_647),
      strength: z.number().int().nonnegative().max(2_147_483_647),
      agility: z.number().int().nonnegative().max(2_147_483_647),
      intelligence: z.number().int().nonnegative().max(2_147_483_647),
      armor: z.number().int().nonnegative().max(2_147_483_647),
      magicResistance: z.number().int().nonnegative().max(2_147_483_647),
    }),
  })
  .strict();
export const pvpBountyCreateSchema = z
  .object({
    requestId,
    operationId,
    targetCharacterId: characterId,
    amountSilver: z.number().int().min(100).max(100_000),
    durationMs: z.number().int().min(60 * 60_000).max(7 * 24 * 60 * 60_000),
  })
  .strict();
export const pvpBountyActionSchema = z.object({ requestId, bountyId }).strict();
export const pvpReplayGetSchema = z.object({ requestId, combatId }).strict();
export const pvpReportSchema = z
  .object({
    requestId,
    operationId,
    combatId,
    category: z.enum(['GRIEFING', 'WINTRADING', 'AFK', 'SPAWN_CAMPING', 'OTHER']),
  })
  .strict();

export type PvpGetPayload = z.infer<typeof pvpGetSchema>;
export type PvpSetOptInPayload = z.infer<typeof pvpSetOptInSchema>;
export type PvpRedeemPayload = z.infer<typeof pvpRedeemSchema>;
export type PvpEngagePayload = z.infer<typeof pvpEngageSchema>;
export type PvpNormalizationPreviewPayload = z.infer<typeof pvpNormalizationPreviewSchema>;
export type PvpBountyCreatePayload = z.infer<typeof pvpBountyCreateSchema>;
export type PvpBountyActionPayload = z.infer<typeof pvpBountyActionSchema>;
export type PvpReplayGetPayload = z.infer<typeof pvpReplayGetSchema>;
export type PvpReportPayload = z.infer<typeof pvpReportSchema>;
