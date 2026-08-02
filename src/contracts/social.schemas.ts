import { z } from 'zod';

const operationId = z.string().regex(/^[A-Za-z0-9:_-]{1,128}$/);
const uuid = z.string().uuid();
const activityKey = z.string().regex(/^[a-z0-9][a-z0-9:_-]{1,95}$/);
const buildFunction = z.enum([
  'PROTECTION', 'INTERRUPT', 'CLEANSE', 'CONTROL',
  'BURST', 'SCOUT', 'SUSTAIN', 'SUPPORT',
]);
const formation = z.enum(['FRONT', 'BACK']);

export const socialGetSchema = z.object({ requestId: operationId });
export const socialFinderCreateSchema = z.object({
  operationId,
  activityType: z.enum(['EXPEDITION', 'WORLD_ENCOUNTER', 'GROUP_QUEST', 'PVP', 'GUILD_CONTRACT']),
  activityKey,
  title: z.string().trim().min(2).max(80),
  minimumSize: z.number().int().min(1).max(10),
  maximumSize: z.number().int().min(1).max(10),
  levelHint: z.object({ minimum: z.number().int().min(1).max(100).optional(), maximum: z.number().int().min(1).max(100).optional() }),
  requestedFunctions: z.array(buildFunction).max(8),
  language: z.string().trim().min(2).max(12),
  expectedMinutes: z.number().int().min(5).max(360),
  riskProfile: z.enum(['LOW', 'STANDARD', 'HIGH', 'RITUAL']),
  requirements: z.object({
    minimumLevel: z.number().int().min(1).max(100).optional(),
    maximumLevel: z.number().int().min(1).max(100).optional(),
    requiredItemKeys: z.array(activityKey).max(8).optional(),
    requiredFlagKeys: z.array(activityKey).max(8).optional(),
  }),
  acceptancePolicy: z.enum(['MANUAL', 'AUTO']),
  decisionPolicy: z.enum(['LEADER', 'VOTE']),
});
export const socialFinderApplySchema = z.object({
  operationId,
  listingId: uuid,
  functions: z.array(buildFunction).min(1).max(8),
});
export const socialFinderRespondSchema = z.object({
  operationId,
  listingId: uuid,
  targetCharacterId: uuid,
  accept: z.boolean(),
});
export const socialFinderReadySchema = z.object({
  operationId,
  listingId: uuid,
  functions: z.array(buildFunction).min(1).max(8),
  formation,
  loadoutReady: z.boolean(),
  riskAccepted: z.boolean(),
  consumableSummary: z.array(z.string().trim().min(1).max(48)).max(8),
});
export const socialFinderMutationSchema = z.object({ operationId, listingId: uuid });
export const socialActivityCompleteSchema = z.object({
  operationId,
  listingId: uuid,
  outcome: z.enum(['COMPLETED', 'FAILED', 'ABANDONED']),
  members: z.array(z.object({
    characterId: uuid,
    finished: z.boolean(),
    disconnected: z.boolean(),
    afk: z.boolean(),
  })).min(1).max(10),
});
export const socialContactSchema = z.object({ operationId, targetCharacterId: uuid });
export const socialBlockSchema = z.object({ operationId, targetCharacterId: uuid, blocked: z.boolean() });
export const socialMentorProfileSchema = z.object({
  operationId,
  active: z.boolean(),
  language: z.string().trim().min(2).max(12),
  activityKeys: z.array(activityKey).max(20),
});
export const socialMentorshipStartSchema = z.object({
  operationId,
  mentorCharacterId: uuid,
  learnerCharacterId: uuid,
  activityKey,
});
export const socialMentorshipProgressSchema = z.object({
  operationId,
  mentorshipId: uuid,
  qualifiedSteps: z.number().int().min(0).max(100),
  afkSeconds: z.number().int().min(0).max(86_400),
});
export const socialMentorshipCompleteSchema = z.object({ operationId, mentorshipId: uuid });
export const socialGuildCreateObjectiveSchema = z.object({
  operationId,
  definitionKey: activityKey,
  definitionVersion: z.number().int().min(1).max(1_000),
});
export const socialGuildContributionSchema = z.object({
  operationId,
  instanceId: uuid,
  kind: z.enum(['ACTIVITY', 'MATERIAL', 'CRAFT', 'REGION', 'CHOICE', 'PVP_OBJECTIVE']),
  amount: z.number().int().min(1).max(10_000),
  sourceKey: activityKey,
  qualified: z.boolean(),
  afk: z.boolean(),
});
export const socialGuildSettleSchema = z.object({ operationId, instanceId: uuid });
export const socialRegionContributionSchema = z.object({
  operationId,
  regionKey: activityKey,
  phaseKey: activityKey,
  amount: z.number().int().min(1).max(10_000),
});
export const socialGuildPermissionSchema = z.object({
  operationId,
  role: z.enum(['LEADER', 'OFFICER', 'MEMBER']),
  permission: z.enum([
    'INVITE', 'KICK', 'ROLE', 'DESCRIPTION', 'DISBAND',
    'BANK_DEPOSIT', 'BANK_WITHDRAW', 'BANK_AUDIT',
    'CONTRACT_MANAGE', 'PROJECT_MANAGE',
    'ANNOUNCEMENT_MANAGE', 'EVENT_MANAGE',
  ]),
  allowed: z.boolean(),
});
export const socialBankDepositSchema = z.object({
  operationId,
  inventoryItemId: uuid,
  quantity: z.number().int().min(1).max(10_000),
  tabKey: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,31}$/),
  projectKey: activityKey.optional(),
});
export const socialBankWithdrawSchema = z.object({
  operationId,
  bankItemId: uuid,
  quantity: z.number().int().min(1).max(10_000),
});
export const socialAnnouncementCreateSchema = z.object({
  operationId,
  title: z.string().trim().min(2).max(80),
  body: z.string().trim().min(1).max(500),
  pinned: z.boolean(),
});
export const socialEventCreateSchema = z.object({
  operationId,
  title: z.string().trim().min(2).max(80),
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(15).max(1_440),
  activityKey: activityKey.optional(),
});
export const socialEventRsvpSchema = z.object({
  operationId,
  eventId: uuid,
  response: z.enum(['YES', 'MAYBE', 'NO']),
});

export type SocialFinderCreatePayload = z.infer<typeof socialFinderCreateSchema>;
export type SocialFinderApplyPayload = z.infer<typeof socialFinderApplySchema>;
export type SocialFinderRespondPayload = z.infer<typeof socialFinderRespondSchema>;
export type SocialFinderReadyPayload = z.infer<typeof socialFinderReadySchema>;
export type SocialFinderMutationPayload = z.infer<typeof socialFinderMutationSchema>;
export type SocialActivityCompletePayload = z.infer<typeof socialActivityCompleteSchema>;
export type SocialContactPayload = z.infer<typeof socialContactSchema>;
export type SocialBlockPayload = z.infer<typeof socialBlockSchema>;
export type SocialMentorProfilePayload = z.infer<typeof socialMentorProfileSchema>;
export type SocialMentorshipStartPayload = z.infer<typeof socialMentorshipStartSchema>;
export type SocialMentorshipProgressPayload = z.infer<typeof socialMentorshipProgressSchema>;
export type SocialMentorshipCompletePayload = z.infer<typeof socialMentorshipCompleteSchema>;
export type SocialGuildCreateObjectivePayload = z.infer<typeof socialGuildCreateObjectiveSchema>;
export type SocialGuildContributionPayload = z.infer<typeof socialGuildContributionSchema>;
export type SocialGuildSettlePayload = z.infer<typeof socialGuildSettleSchema>;
export type SocialRegionContributionPayload = z.infer<typeof socialRegionContributionSchema>;
export type SocialGuildPermissionPayload = z.infer<typeof socialGuildPermissionSchema>;
export type SocialBankDepositPayload = z.infer<typeof socialBankDepositSchema>;
export type SocialBankWithdrawPayload = z.infer<typeof socialBankWithdrawSchema>;
export type SocialAnnouncementCreatePayload = z.infer<typeof socialAnnouncementCreateSchema>;
export type SocialEventCreatePayload = z.infer<typeof socialEventCreateSchema>;
export type SocialEventRsvpPayload = z.infer<typeof socialEventRsvpSchema>;
