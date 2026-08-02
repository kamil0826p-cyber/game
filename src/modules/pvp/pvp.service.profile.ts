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
import { PvpServiceBase } from './pvp.service.base.js';

export abstract class PvpServiceProfile extends PvpServiceBase {
  async markSpawnProtected(characterId: string, now = Date.now()): Promise<void> {
    await this.ensureProfile(this.prisma, characterId);
    await this.prisma.$executeRaw`
      UPDATE "PvpProfile"
      SET "spawnProtectedUntil" = ${new Date(now + PVP_SPAWN_PROTECTION_MS)},
          "reconnectProtectedUntil" = ${new Date(now + PVP_RECONNECT_PROTECTION_MS)},
          "updatedAt" = NOW()
      WHERE "characterId" = ${characterId}::uuid
    `;
  }

  async setOptIn(userId: string, characterId: string, optedIn: boolean): Promise<PvpOverview> {
    await this.requireOwnedCharacter(this.prisma, userId, characterId);
    await this.ensureProfile(this.prisma, characterId);
    await this.prisma.$executeRaw`
      UPDATE "PvpProfile"
      SET "optedIn" = ${optedIn}, "updatedAt" = NOW()
      WHERE "characterId" = ${characterId}::uuid
    `;
    return this.getOverview(userId, characterId);
  }

  async getOverview(userId: string, characterId: string): Promise<PvpOverview> {
    await this.requireOwnedCharacter(this.prisma, userId, characterId);
    await this.expireBounties(Date.now());
    await this.applyNotorietyDecay(characterId);
    const profile = await this.getProfile(characterId);
    const bounties = await this.listBounties(characterId);
    return {
      rulesVersion: 1,
      profile: {
        optedIn: profile.optedIn,
        notoriety: profile.notoriety,
        notorietyTier: notorietyTier(profile.notoriety),
        consequences: this.notorietyConsequences(profile.notoriety),
        protections: {
          ...(profile.spawnProtectedUntil
            ? { spawnUntil: profile.spawnProtectedUntil.getTime() }
            : {}),
          ...(profile.reconnectProtectedUntil
            ? { reconnectUntil: profile.reconnectProtectedUntil.getTime() }
            : {}),
          ...(profile.defeatProtectedUntil
            ? { defeatUntil: profile.defeatProtectedUntil.getTime() }
            : {}),
          ...(profile.combatCooldownUntil
            ? { combatCooldownUntil: profile.combatCooldownUntil.getTime() }
            : {}),
        },
      },
      activeSeason: ACTIVE_SEASON,
      modes: listPvpModes(),
      bounties,
    };
  }

  async redeemNotoriety(input: {
    userId: string;
    characterId: string;
    points: number;
    operationId: string;
  }): Promise<PvpOverview> {
    if (!Number.isInteger(input.points) || input.points < 1 || input.points > 20) {
      throw new RangeError('PVP_REDEMPTION_POINTS_INVALID');
    }
    if (!/^[A-Za-z0-9:_-]{8,96}$/.test(input.operationId)) {
      throw new TypeError('PVP_REDEMPTION_OPERATION_INVALID');
    }
    const ledgerOperationId = `pvp-redemption:${input.operationId}`;
    await this.prisma.$transaction(async (transaction) => {
      await this.requireOwnedCharacter(transaction, input.userId, input.characterId);
      await this.ensureProfile(transaction, input.characterId);
      const existing = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "CharacterCurrencyLedger"
        WHERE "characterId" = ${input.characterId}::uuid
          AND "operationId" = ${ledgerOperationId}
        LIMIT 1
      `;
      if (existing[0]) return;
      const profiles = await transaction.$queryRaw<Array<{ notoriety: number }>>`
        SELECT "notoriety"
        FROM "PvpProfile"
        WHERE "characterId" = ${input.characterId}::uuid
        FOR UPDATE
      `;
      const actualPoints = Math.min(input.points, profiles[0]?.notoriety ?? 0);
      if (actualPoints <= 0) throw new Error('PVP_REDEMPTION_NOT_NEEDED');
      const priceSilver = actualPoints * 250;
      const debited = await transaction.$queryRaw<Array<{ silver: number }>>`
        UPDATE "Character"
        SET "silver" = "silver" - ${priceSilver}
        WHERE "id" = ${input.characterId}::uuid
          AND "userId" = ${input.userId}::uuid
          AND "silver" >= ${priceSilver}
        RETURNING "silver"
      `;
      if (!debited[0]) throw new Error('PVP_REDEMPTION_INSUFFICIENT_SILVER');
      await transaction.$executeRaw`
        INSERT INTO "CharacterCurrencyLedger"
          ("id", "characterId", "operationId", "currency", "direction", "amount",
           "reason", "balanceAfter", "metadata")
        VALUES
          (${randomUUID()}::uuid, ${input.characterId}::uuid,
           ${ledgerOperationId}, 'SILVER'::"CurrencyType",
           'DEBIT'::"CurrencyDirection", ${priceSilver}, 'PVP_NOTORIETY_REDEMPTION',
           ${debited[0].silver}, ${JSON.stringify({ requestedPoints: input.points, points: actualPoints })}::jsonb)
      `;
      await transaction.$executeRaw`
        UPDATE "PvpProfile"
        SET "notoriety" = GREATEST(0, "notoriety" - ${actualPoints}),
            "notorietyChangedAt" = NOW(), "updatedAt" = NOW()
        WHERE "characterId" = ${input.characterId}::uuid
      `;
      await this.enqueueOutbox(
        transaction,
        input.characterId,
        'PVP_NOTORIETY_REDEEMED',
        `pvp-redemption:${input.characterId}:${input.operationId}`,
        { points: actualPoints, priceSilver },
      );
    });
    return this.getOverview(input.userId, input.characterId);
  }

  async getNormalizationPreview(
    userId: string,
    characterId: string,
    modeKey: PvpModeKey,
    level: number,
    stats: PvpPowerStats,
  ) {
    await this.requireOwnedCharacter(this.prisma, userId, characterId);
    const mode = getPvpModeDefinition(modeKey);
    return {
      mode,
      preview: previewPvpNormalization(characterId, level, stats),
    };
  }

  protected notorietyConsequences(notoriety: number): PvpOverview['profile']['consequences'] {
    const tier = notorietyTier(notoriety);
    if (tier === 'HUNTED') {
      return {
        merchantSurchargePercent: 25,
        guardedNpcServicesBlocked: true,
        guardedPortalBlocked: true,
        visibleToBountyHunters: true,
      };
    }
    if (tier === 'OUTLAW') {
      return {
        merchantSurchargePercent: 15,
        guardedNpcServicesBlocked: true,
        guardedPortalBlocked: false,
        visibleToBountyHunters: true,
      };
    }
    if (tier === 'AGGRESSOR') {
      return {
        merchantSurchargePercent: 5,
        guardedNpcServicesBlocked: false,
        guardedPortalBlocked: false,
        visibleToBountyHunters: false,
      };
    }
    return {
      merchantSurchargePercent: 0,
      guardedNpcServicesBlocked: false,
      guardedPortalBlocked: false,
      visibleToBountyHunters: false,
    };
  }

  protected async applyNotorietyDecay(characterId: string): Promise<void> {
    await this.ensureProfile(this.prisma, characterId);
    await this.prisma.$executeRaw`
      UPDATE "PvpProfile"
      SET "notoriety" = GREATEST(
            0,
            "notoriety" - FLOOR(EXTRACT(EPOCH FROM (NOW() - "notorietyChangedAt")) / 1800)::integer
          ),
          "notorietyChangedAt" = "notorietyChangedAt" +
            (FLOOR(EXTRACT(EPOCH FROM (NOW() - "notorietyChangedAt")) / 1800) * INTERVAL '30 minutes'),
          "updatedAt" = NOW()
      WHERE "characterId" = ${characterId}::uuid
        AND "notoriety" > 0
        AND "notorietyChangedAt" <= NOW() - INTERVAL '30 minutes'
    `;
  }

  protected async getProfile(
    characterId: string,
    database: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<PvpProfileRow> {
    await this.ensureProfile(database, characterId);
    const rows = await database.$queryRaw<PvpProfileRow[]>`
      SELECT "characterId", "optedIn", "notoriety", "notorietyChangedAt",
             "spawnProtectedUntil", "reconnectProtectedUntil", "defeatProtectedUntil",
             "combatCooldownUntil"
      FROM "PvpProfile"
      WHERE "characterId" = ${characterId}::uuid
      LIMIT 1
    `;
    if (!rows[0]) throw new Error('PVP_PROFILE_NOT_FOUND');
    return rows[0];
  }

  protected async ensureProfile(
    database: Prisma.TransactionClient | PrismaService,
    characterId: string,
  ): Promise<void> {
    await database.$executeRaw`
      INSERT INTO "PvpProfile" ("characterId", "createdAt", "updatedAt")
      VALUES (${characterId}::uuid, NOW(), NOW())
      ON CONFLICT ("characterId") DO NOTHING
    `;
  }

}
