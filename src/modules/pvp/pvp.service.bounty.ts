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
import { PvpServiceBountySupport } from './pvp.service.bounty-support.js';

export class PvpServiceBounty extends PvpServiceBountySupport {
  async createBounty(input: {
    userId: string;
    creatorCharacterId: string;
    targetCharacterId: string;
    amountSilver: number;
    durationMs: number;
    operationId: string;
  }): Promise<PvpBountyView> {
    if (
      !Number.isInteger(input.amountSilver) ||
      input.amountSilver < BOUNTY_MIN_SILVER ||
      input.amountSilver > BOUNTY_MAX_SILVER
    ) {
      throw new RangeError('PVP_BOUNTY_AMOUNT_INVALID');
    }
    if (
      !Number.isInteger(input.durationMs) ||
      input.durationMs < BOUNTY_MIN_DURATION_MS ||
      input.durationMs > BOUNTY_MAX_DURATION_MS
    ) {
      throw new RangeError('PVP_BOUNTY_DURATION_INVALID');
    }
    if (!/^[A-Za-z0-9:_-]{8,96}$/.test(input.operationId)) {
      throw new TypeError('PVP_BOUNTY_OPERATION_INVALID');
    }
    const now = Date.now();
    const proposedBountyId = randomUUID();
    const feeSilver = Math.max(10, Math.ceil(input.amountSilver * 0.05));

    let bountyId: string;
    try {
      bountyId = await this.prisma.$transaction(async (transaction) => {
        const existing = await this.findBountyOperation(
          transaction,
          input.creatorCharacterId,
          input.operationId,
        );
        if (existing) {
          this.assertSameBountyOperation(existing, input);
          return existing.id;
        }
        const creator = await this.requireOwnedCharacter(
          transaction,
          input.userId,
          input.creatorCharacterId,
        );
        const target = await this.requireCharacter(transaction, input.targetCharacterId);
        if (creator.userId === target.userId) throw new Error('PVP_BOUNTY_SAME_ACCOUNT');
        const recent = await transaction.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS "count"
          FROM "PvpBounty"
          WHERE "creatorCharacterId" = ${input.creatorCharacterId}::uuid
            AND "createdAt" >= ${new Date(now - 24 * 60 * 60_000)}
        `;
        if (Number(recent[0]?.count ?? 0) >= BOUNTY_CREATE_LIMIT_PER_DAY) {
          throw new Error('PVP_BOUNTY_RATE_LIMITED');
        }
        const debited = await transaction.$queryRaw<Array<{ silver: number }>>`
          UPDATE "Character"
          SET "silver" = "silver" - ${input.amountSilver + feeSilver}
          WHERE "id" = ${input.creatorCharacterId}::uuid
            AND "userId" = ${input.userId}::uuid
            AND "silver" >= ${input.amountSilver + feeSilver}
          RETURNING "silver"
        `;
        if (!debited[0]) throw new Error('PVP_BOUNTY_INSUFFICIENT_SILVER');
        await transaction.$executeRaw`
          INSERT INTO "CharacterCurrencyLedger"
            ("id", "characterId", "operationId", "currency", "direction", "amount",
             "reason", "balanceAfter", "metadata")
          VALUES
            (${randomUUID()}::uuid, ${input.creatorCharacterId}::uuid,
             ${`pvp-bounty:${input.operationId}`}, 'SILVER'::"CurrencyType",
             'DEBIT'::"CurrencyDirection", ${input.amountSilver + feeSilver},
             'PVP_BOUNTY_ESCROW', ${debited[0].silver},
             ${JSON.stringify({ bountyId: proposedBountyId, targetCharacterId: input.targetCharacterId, feeSilver, durationMs: input.durationMs })}::jsonb)
        `;
        await transaction.$executeRaw`
          INSERT INTO "PvpBounty"
            ("id", "targetCharacterId", "creatorCharacterId", "amountSilver", "feeSilver",
             "status", "operationId", "createdAt", "expiresAt")
          VALUES
            (${proposedBountyId}::uuid, ${input.targetCharacterId}::uuid,
             ${input.creatorCharacterId}::uuid, ${input.amountSilver}, ${feeSilver},
             'OPEN', ${input.operationId}, ${new Date(now)}, ${new Date(now + input.durationMs)})
        `;
        await this.enqueueOutbox(
          transaction,
          proposedBountyId,
          'PVP_BOUNTY_CREATED',
          `pvp-bounty-created:${proposedBountyId}`,
          {
            creatorCharacterId: input.creatorCharacterId,
            targetCharacterId: input.targetCharacterId,
            amountSilver: input.amountSilver,
            feeSilver,
            expiresAt: now + input.durationMs,
          },
        );
        return proposedBountyId;
      });
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) throw error;
      const existing = await this.findBountyOperation(
        this.prisma,
        input.creatorCharacterId,
        input.operationId,
      );
      if (!existing) throw error;
      this.assertSameBountyOperation(existing, input);
      bountyId = existing.id;
    }
    const view = await this.findBountyView(bountyId, input.creatorCharacterId);
    if (!view) throw new Error('PVP_BOUNTY_CREATE_FAILED');
    return view;
  }

  async acceptBounty(
    userId: string,
    hunterCharacterId: string,
    bountyId: string,
  ): Promise<PvpBountyView> {
    await this.prisma.$transaction(async (transaction) => {
      const hunter = await this.requireOwnedCharacter(transaction, userId, hunterCharacterId);
      const rows = await transaction.$queryRaw<BountyRow[]>`
        SELECT * FROM "PvpBounty"
        WHERE "id" = ${bountyId}::uuid
        FOR UPDATE
      `;
      const bounty = rows[0];
      if (!bounty || bounty.status !== 'OPEN' || bounty.expiresAt.getTime() <= Date.now()) {
        throw new Error('PVP_BOUNTY_NOT_AVAILABLE');
      }
      const target = await this.requireCharacter(transaction, bounty.targetCharacterId);
      if (target.userId === hunter.userId || bounty.targetCharacterId === hunterCharacterId) {
        throw new Error('PVP_BOUNTY_SAME_ACCOUNT');
      }
      const active = await transaction.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS "count"
        FROM "PvpBounty"
        WHERE "hunterCharacterId" = ${hunterCharacterId}::uuid
          AND "status" = 'ACCEPTED'
          AND "expiresAt" > NOW()
      `;
      if (Number(active[0]?.count ?? 0) >= 3) throw new Error('PVP_BOUNTY_HUNTER_LIMIT');
      await transaction.$executeRaw`
        UPDATE "PvpBounty"
        SET "hunterCharacterId" = ${hunterCharacterId}::uuid,
            "status" = 'ACCEPTED', "acceptedAt" = NOW()
        WHERE "id" = ${bountyId}::uuid
      `;
    });
    const view = await this.findBountyView(bountyId, hunterCharacterId);
    if (!view) throw new Error('PVP_BOUNTY_NOT_AVAILABLE');
    return view;
  }

  async cancelBounty(
    userId: string,
    creatorCharacterId: string,
    bountyId: string,
  ): Promise<PvpBountyView> {
    await this.prisma.$transaction(async (transaction) => {
      await this.requireOwnedCharacter(transaction, userId, creatorCharacterId);
      const rows = await transaction.$queryRaw<BountyRow[]>`
        SELECT * FROM "PvpBounty"
        WHERE "id" = ${bountyId}::uuid
        FOR UPDATE
      `;
      const bounty = rows[0];
      if (
        !bounty ||
        bounty.creatorCharacterId !== creatorCharacterId ||
        bounty.status !== 'OPEN'
      ) {
        throw new Error('PVP_BOUNTY_CANNOT_CANCEL');
      }
      await transaction.$executeRaw`
        UPDATE "PvpBounty"
        SET "status" = 'CANCELLED', "closedAt" = NOW()
        WHERE "id" = ${bountyId}::uuid
      `;
      await this.creditSilver(
        transaction,
        creatorCharacterId,
        bounty.amountSilver,
        `pvp-bounty-cancel:${bounty.id}`,
        'PVP_BOUNTY_REFUND',
        { bountyId: bounty.id },
      );
    });
    const view = await this.findBountyView(bountyId, creatorCharacterId);
    if (!view) throw new Error('PVP_BOUNTY_NOT_FOUND');
    return view;
  }

}
