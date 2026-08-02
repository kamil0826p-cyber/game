import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { CombatActionResolutionPayload } from '../../contracts/socket.events.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { pvpSettlementOperationId, splitPvpEscrow } from './pvp.ledger.js';
import {
  PVP_COMBAT_COOLDOWN_MS,
  PVP_DEFEAT_PROTECTION_MS,
  PVP_NEWCOMER_LEVEL_LIMIT,
  PVP_RECONNECT_PROTECTION_MS,
  PVP_SAME_OPPONENT_COOLDOWN_MS,
  PVP_SPAWN_PROTECTION_MS,
  assessPvpContribution,
  calculatePvpRatingUpdate,
  evaluatePvpEngagement,
  getPvpModeDefinition,
  listPvpModes,
  notorietyTier,
  previewPvpNormalization,
  pvpReplayChecksum,
} from './pvp.rules.js';
import type {
  PvpEngagementDecision,
  PvpEngagementKind,
  PvpModeKey,
  PvpPowerStats,
  PvpReplayEnvelope,
  PvpZoneType,
} from './pvp.types.js';
import {
  ACTIVE_SEASON,
  BOUNTY_CREATE_LIMIT_PER_DAY,
  BOUNTY_MAX_DURATION_MS,
  BOUNTY_MAX_SILVER,
  BOUNTY_MIN_DURATION_MS,
  BOUNTY_MIN_SILVER,
  MAX_CURRENCY_AMOUNT,
  type ApprovedPvpCombatInput,
  type BountyRow,
  type EvaluatePvpCombatInput,
  type PvpBountyView,
  type PvpCombatRow,
  type PvpContributionAggregateRow,
  type PvpOverview,
  type PvpProfileRow,
  type PvpRatingRow,
  type RegisterPvpCombatInput,
  type SettlePvpCombatInput,
  PvpPolicyViolationError,
} from './pvp.service.shared.js';
import { PvpServicePolicy } from './pvp.service.policy.js';

export abstract class PvpServiceEconomy extends PvpServicePolicy {
  protected async persistRating(
    transaction: Prisma.TransactionClient,
    characterId: string,
    poolKey: string,
    update: ReturnType<typeof calculatePvpRatingUpdate>,
  ): Promise<void> {
    await transaction.$executeRaw`
      UPDATE "PvpRating"
      SET "rating" = ${update.nextRating},
          "uncertainty" = ${update.nextUncertainty},
          "placementMatchesRemaining" = ${update.placementMatchesRemaining},
          "gamesPlayed" = "gamesPlayed" + 1,
          "updatedAt" = NOW()
      WHERE "characterId" = ${characterId}::uuid
        AND "poolKey" = ${poolKey}
        AND "seasonKey" = ${ACTIVE_SEASON.key}
    `;
  }

  protected async claimBounty(
    transaction: Prisma.TransactionClient,
    bountyId: string,
    winners: readonly string[],
    losers: readonly string[],
    assessments: ReadonlyMap<string, ReturnType<typeof assessPvpContribution>>,
    combatId: string,
    finishedAt: number,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<BountyRow[]>`
      SELECT * FROM "PvpBounty"
      WHERE "id" = ${bountyId}::uuid
      FOR UPDATE
    `;
    const bounty = rows[0];
    if (
      !bounty ||
      bounty.status !== 'ACCEPTED' ||
      bounty.expiresAt.getTime() <= finishedAt ||
      !losers.includes(bounty.targetCharacterId) ||
      !bounty.hunterCharacterId ||
      !winners.includes(bounty.hunterCharacterId)
    ) {
      return;
    }
    const eligible = winners.filter((winner) => assessments.get(winner)?.eligible);
    const shares = splitPvpEscrow(bounty.amountSilver, eligible);
    if (shares.length === 0) return;
    for (const share of shares) {
      await this.creditSilver(
        transaction,
        share.characterId,
        share.amountSilver,
        `pvp-bounty-claim:${bounty.id}:${share.characterId}`,
        'PVP_BOUNTY_CLAIM',
        { bountyId: bounty.id, combatId },
      );
    }
    await transaction.$executeRaw`
      UPDATE "PvpBounty"
      SET "status" = 'CLAIMED', "claimedCombatId" = ${combatId}::uuid,
          "closedAt" = ${new Date(finishedAt)}
      WHERE "id" = ${bounty.id}::uuid
        AND "status" = 'ACCEPTED'
    `;
  }

  protected async creditSilver(
    transaction: Prisma.TransactionClient,
    characterId: string,
    amount: number,
    operationId: string,
    reason: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const existing = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "CharacterCurrencyLedger"
      WHERE "characterId" = ${characterId}::uuid
        AND "operationId" = ${operationId}
      LIMIT 1
    `;
    if (existing[0]) return;
    const rows = await transaction.$queryRaw<Array<{ silver: number }>>`
      UPDATE "Character"
      SET "silver" = "silver" + ${amount}
      WHERE "id" = ${characterId}::uuid
        AND "silver" + ${amount} <= ${MAX_CURRENCY_AMOUNT}
      RETURNING "silver"
    `;
    if (!rows[0]) throw new Error('PVP_CURRENCY_RANGE_EXCEEDED');
    await transaction.$executeRaw`
      INSERT INTO "CharacterCurrencyLedger"
        ("id", "characterId", "operationId", "currency", "direction", "amount",
         "reason", "balanceAfter", "metadata")
      VALUES
        (${randomUUID()}::uuid, ${characterId}::uuid, ${operationId},
         'SILVER'::"CurrencyType", 'CREDIT'::"CurrencyDirection", ${amount},
         ${reason}, ${rows[0].silver}, ${JSON.stringify(metadata)}::jsonb)
    `;
  }

  protected async enqueueOutbox(
    transaction: Prisma.TransactionClient,
    aggregateId: string,
    eventType: string,
    operationId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await transaction.$executeRaw`
      INSERT INTO "PvpOutbox"
        ("id", "aggregateId", "eventType", "operationId", "payload", "createdAt")
      VALUES
        (${randomUUID()}::uuid, ${aggregateId}, ${eventType}, ${operationId},
         ${JSON.stringify(payload)}::jsonb, NOW())
      ON CONFLICT ("operationId") DO NOTHING
    `;
  }

  protected async recordRiskSignal(
    transaction: Prisma.TransactionClient,
    combatId: string | undefined,
    characterId: string | undefined,
    signalType: string,
    riskScore: number,
    operationId: string,
    evidence: Record<string, unknown>,
  ): Promise<void> {
    await transaction.$executeRaw`
      INSERT INTO "PvpRiskSignal"
        ("id", "combatId", "characterId", "signalType", "riskScore",
         "operationId", "evidence", "createdAt")
      VALUES
        (${randomUUID()}::uuid, ${combatId ?? null}::uuid, ${characterId ?? null}::uuid,
         ${signalType}, ${Math.max(0, Math.min(100, Math.round(riskScore)))},
         ${operationId}, ${JSON.stringify(evidence)}::jsonb, NOW())
      ON CONFLICT ("operationId") DO NOTHING
    `;
  }

}
