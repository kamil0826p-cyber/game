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
import { PvpServiceSettlement } from './pvp.service.settlement.js';

export class PvpServiceBountySupport extends PvpServiceSettlement {
  protected async findBountyOperation(
    database: Prisma.TransactionClient | PrismaService,
    creatorCharacterId: string,
    operationId: string,
  ): Promise<(BountyRow & { durationMs: number }) | undefined> {
    const rows = await database.$queryRaw<Array<BountyRow & { durationMs: number }>>`
      SELECT *,
             FLOOR(EXTRACT(EPOCH FROM ("expiresAt" - "createdAt")) * 1000)::integer
               AS "durationMs"
      FROM "PvpBounty"
      WHERE "creatorCharacterId" = ${creatorCharacterId}::uuid
        AND "operationId" = ${operationId}
      LIMIT 1
    `;
    return rows[0];
  }

  protected assertSameBountyOperation(
    existing: BountyRow & { durationMs: number },
    input: { targetCharacterId: string; amountSilver: number; durationMs: number },
  ): void {
    if (
      existing.targetCharacterId !== input.targetCharacterId ||
      existing.amountSilver !== input.amountSilver ||
      Math.abs(existing.durationMs - input.durationMs) > 1_000
    ) {
      throw new Error('PVP_BOUNTY_OPERATION_CONFLICT');
    }
  }

  protected isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }

  protected async expireBounties(now: number): Promise<void> {
    const rows = await this.prisma.$queryRaw<BountyRow[]>`
      SELECT * FROM "PvpBounty"
      WHERE "status" IN ('OPEN', 'ACCEPTED')
        AND "expiresAt" <= ${new Date(now)}
      LIMIT 50
    `;
    for (const bounty of rows) {
      await this.prisma.$transaction(async (transaction) => {
        const updated = await transaction.$queryRaw<Array<{ id: string }>>`
          UPDATE "PvpBounty"
          SET "status" = 'EXPIRED', "closedAt" = ${new Date(now)}
          WHERE "id" = ${bounty.id}::uuid
            AND "status" IN ('OPEN', 'ACCEPTED')
          RETURNING "id"
        `;
        if (updated[0] && bounty.creatorCharacterId) {
          await this.creditSilver(
            transaction,
            bounty.creatorCharacterId,
            bounty.amountSilver,
            `pvp-bounty-expire:${bounty.id}`,
            'PVP_BOUNTY_REFUND',
            { bountyId: bounty.id },
          );
        }
      });
    }
  }

  protected async listBounties(viewerCharacterId: string): Promise<PvpBountyView[]> {
    const rows = await this.prisma.$queryRaw<BountyRow[]>`
      SELECT b.*, c."name" AS "targetName", c."level" AS "targetLevel", m."key" AS "regionKey"
      FROM "PvpBounty" b
      JOIN "Character" c ON c."id" = b."targetCharacterId"
      LEFT JOIN "Map" m ON m."id" = c."mapId"
      WHERE b."status" IN ('OPEN', 'ACCEPTED')
        AND b."expiresAt" > NOW()
      ORDER BY b."amountSilver" DESC, b."createdAt" ASC
      LIMIT 50
    `;
    return rows.map((row) => this.toBountyView(row, viewerCharacterId));
  }

  protected async findBountyView(
    bountyId: string,
    viewerCharacterId: string,
  ): Promise<PvpBountyView | undefined> {
    const rows = await this.prisma.$queryRaw<BountyRow[]>`
      SELECT b.*, c."name" AS "targetName", c."level" AS "targetLevel", m."key" AS "regionKey"
      FROM "PvpBounty" b
      JOIN "Character" c ON c."id" = b."targetCharacterId"
      LEFT JOIN "Map" m ON m."id" = c."mapId"
      WHERE b."id" = ${bountyId}::uuid
      LIMIT 1
    `;
    return rows[0] ? this.toBountyView(rows[0], viewerCharacterId) : undefined;
  }

  protected toBountyView(row: BountyRow, viewerCharacterId: string): PvpBountyView {
    return {
      id: row.id,
      targetCharacterId: row.targetCharacterId,
      targetName: row.targetName ?? 'Unknown',
      targetLevel: row.targetLevel ?? 1,
      amountSilver: row.amountSilver,
      status: row.status,
      expiresAt: row.expiresAt.getTime(),
      acceptedByMe: row.hunterCharacterId === viewerCharacterId,
      createdByMe: row.creatorCharacterId === viewerCharacterId,
      ...(row.regionKey ? { regionHint: row.regionKey } : {}),
    };
  }

}
