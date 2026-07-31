import { z } from 'zod';

const identifier = z.string().trim().min(1).max(160);
const optionalIdentifier = identifier.optional();

export const telemetryContextSchema = z.object({
  sessionId: optionalIdentifier,
  userId: optionalIdentifier,
  characterId: optionalIdentifier,
  realmId: optionalIdentifier,
  clientVersion: z.string().trim().min(1).max(64).optional(),
});

const emptyPayload = z.object({}).strict();
const durationPayload = z.object({ durationMs: z.number().int().nonnegative() });

export const telemetryPayloadSchemas = {
  account_registered: emptyPayload,
  character_created: z.object({ characterClass: z.enum(['MAGE', 'WARRIOR', 'ARCHER']) }),
  world_entered: z.object({ mapId: identifier }),
  tutorial_step_completed: z.object({ sequenceKey: identifier, stepKey: identifier }),
  quest_started: z.object({ questKey: identifier }),
  quest_completed: z.object({ questKey: identifier, durationMs: z.number().int().nonnegative().optional() }),
  combat_started: z.object({ combatId: identifier, mode: z.enum(['PVE', 'PVP']), participantCount: z.number().int().positive() }),
  combat_finished: z.object({
    combatId: identifier,
    mode: z.enum(['PVE', 'PVP']),
    durationMs: z.number().int().nonnegative(),
    turnCount: z.number().int().nonnegative(),
    timeoutCount: z.number().int().nonnegative(),
    finishReason: identifier,
  }),
  combat_forfeited: z.object({ combatId: identifier, reason: identifier }),
  player_defeated: z.object({ combatId: identifier, sourceKind: z.enum(['PLAYER', 'MOB', 'ENVIRONMENT']) }),
  party_joined: z.object({ partyId: identifier, memberCount: z.number().int().positive() }),
  guild_joined: z.object({ guildId: identifier }),
  trade_completed: z.object({ tradeId: identifier, itemCount: z.number().int().nonnegative(), silverTransferred: z.number().int().nonnegative() }),
  item_crafted: z.object({ recipeKey: identifier, quantity: z.number().int().positive() }),
  currency_changed: z.object({
    currency: z.enum(['SILVER', 'GOLD']),
    direction: z.enum(['CREDIT', 'DEBIT']),
    amount: z.number().int().positive(),
    reason: identifier,
  }),
  item_received: z.object({ itemKey: identifier, quantity: z.number().int().positive(), source: identifier }),
  turn_timed_out: z.object({ combatId: identifier, turnNumber: z.number().int().positive() }),
  session_ended: durationPayload.extend({ reason: identifier }),
} as const;

export type TelemetryEventName = keyof typeof telemetryPayloadSchemas;
export type TelemetryContext = z.input<typeof telemetryContextSchema>;

export interface TelemetryEnvelope {
  eventId: string;
  name: TelemetryEventName;
  schemaVersion: 1;
  occurredAt: string;
  serverVersion: string;
  context: z.output<typeof telemetryContextSchema>;
  payload: Record<string, unknown>;
}

export const parseTelemetryPayload = (
  name: TelemetryEventName,
  payload: unknown,
): Record<string, unknown> =>
  telemetryPayloadSchemas[name].parse(payload) as Record<string, unknown>;
