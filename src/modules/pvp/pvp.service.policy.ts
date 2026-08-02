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
import { PvpServiceProfile } from './pvp.service.profile.js';

export abstract class PvpServicePolicy extends PvpServiceProfile {
  async evaluateCombat(input: EvaluatePvpCombatInput): Promise<PvpEngagementDecision> {
    const now = input.now ?? Date.now();
    if (input.attackers.length === 0 || input.defenders.length === 0) {
      throw new PvpPolicyViolationError('EMPTY_TEAM');
    }

    return this.prisma.$transaction(async (transaction) => {
      for (const participant of [...input.attackers, ...input.defenders]) {
        await this.ensureProfile(transaction, participant.characterId);
      }
      const defenderProfiles = await Promise.all(
        input.defenders.map((participant) => this.getProfile(participant.characterId, transaction)),
      );
      const opponentState = await this.getRepeatedOpponentState(
        transaction,
        input.attackers.map((entry) => entry.characterId),
        input.defenders.map((entry) => entry.characterId),
        now,
      );
      const bounty = input.bountyId
        ? await this.requireAcceptedBounty(
            transaction,
            input.bountyId,
            input.attackers.map((entry) => entry.characterId),
            input.defenders.map((entry) => entry.characterId),
          )
        : undefined;
      const maxDate = (field: keyof Pick<
        PvpProfileRow,
        | 'spawnProtectedUntil'
        | 'reconnectProtectedUntil'
        | 'defeatProtectedUntil'
        | 'combatCooldownUntil'
      >): number | undefined => {
        const values = defenderProfiles
          .map((profile) => profile[field]?.getTime())
          .filter((value): value is number => typeof value === 'number');
        return values.length > 0 ? Math.max(...values) : undefined;
      };
      const decision = evaluatePvpEngagement(
        {
          zoneType: input.zoneType,
          kind: input.kind,
          modeKey: input.modeKey,
          attackers: input.attackers.map((entry) => ({
            characterId: entry.characterId,
            userId: entry.userId,
            level: entry.level,
            teamId: 'ATTACKER',
            partySize: input.attackers.length,
            isPremade: input.attackers.length > 1,
            optedIntoPvp: true,
          })),
          defenders: input.defenders.map((entry, index) => ({
            characterId: entry.characterId,
            userId: entry.userId,
            level: entry.level,
            teamId: 'DEFENDER',
            partySize: input.defenders.length,
            isPremade: input.defenders.length > 1,
            optedIntoPvp: defenderProfiles[index]?.optedIn ?? false,
          })),
          consented: input.consented,
          activeBountyContract: Boolean(bounty),
          rankedQueue: input.kind === 'RANKED' || input.kind === 'OBJECTIVE',
          normalized: input.normalized ?? false,
          defenderProtection: {
            newcomerProtected: input.defenders.some(
              (entry, index) =>
                entry.level <= PVP_NEWCOMER_LEVEL_LIMIT &&
                !(defenderProfiles[index]?.optedIn ?? false),
            ),
            spawnProtectedUntil: Math.max(
              maxDate('spawnProtectedUntil') ?? 0,
              ...input.defenders.map((entry) => entry.connectedAt + PVP_SPAWN_PROTECTION_MS),
            ),
            reconnectProtectedUntil: Math.max(
              maxDate('reconnectProtectedUntil') ?? 0,
              ...input.defenders.map((entry) => entry.connectedAt + PVP_RECONNECT_PROTECTION_MS),
            ),
            defeatProtectedUntil: maxDate('defeatProtectedUntil'),
            combatCooldownUntil: maxDate('combatCooldownUntil'),
            sameOpponentCooldownUntil: opponentState.lastDefeatedAt
              ? opponentState.lastDefeatedAt + PVP_SAME_OPPONENT_COOLDOWN_MS
              : undefined,
          },
          repeatedDefeatsInWindow: opponentState.count,
        },
        now,
      );
      if (!decision.allowed) throw new PvpPolicyViolationError(decision.reason!);
      return decision;
    });
  }

  async recordApprovedCombat(input: ApprovedPvpCombatInput): Promise<void> {
    const now = input.now ?? Date.now();
    const mode = input.modeKey ? getPvpModeDefinition(input.modeKey) : undefined;
    const attackerJson = JSON.stringify(input.attackers.map((entry) => entry.characterId));
    const defenderJson = JSON.stringify(input.defenders.map((entry) => entry.characterId));
    await this.prisma.$transaction(async (transaction) => {
      const inserted = await transaction.$queryRaw<Array<{ combatId: string }>>`
        INSERT INTO "PvpCombat"
          ("combatId", "mapId", "zoneType", "kind", "modeKey", "ratingPool",
           "rulesVersion", "attackerTeam", "defenderTeam", "legalAggression",
           "rewardMultiplier", "bountyId", "status", "startedAt")
        VALUES
          (${input.combatId}::uuid, ${input.mapId}::uuid, ${input.zoneType}, ${input.kind},
           ${input.modeKey ?? null}, ${mode?.ratingPool ?? null}, 1,
           ${attackerJson}::jsonb, ${defenderJson}::jsonb, ${input.decision.legalAggression},
           ${input.decision.rewardMultiplier}, ${input.bountyId ?? null}::uuid, 'ACTIVE', ${new Date(now)})
        ON CONFLICT ("combatId") DO NOTHING
        RETURNING "combatId"
      `;
      if (!inserted[0]) return;
      await this.enqueueOutbox(
        transaction,
        input.combatId,
        'PVP_COMBAT_STARTED',
        `pvp-combat-started:${input.combatId}`,
        {
          zoneType: input.zoneType,
          kind: input.kind,
          modeKey: input.modeKey,
          attackerTeamSize: input.attackers.length,
          defenderTeamSize: input.defenders.length,
          normalized: input.decision.normalized,
          legalAggression: input.decision.legalAggression,
          rewardMultiplier: input.decision.rewardMultiplier,
        },
      );
      if (input.decision.rewardMultiplier < 1) {
        await this.recordRiskSignal(
          transaction,
          input.combatId,
          input.attackers[0]?.characterId,
          'REPEATED_OPPONENT_PAIR',
          input.decision.rewardMultiplier === 0 ? 80 : 45,
          `pvp-risk-repeat:${input.combatId}`,
          { rewardMultiplier: input.decision.rewardMultiplier },
        );
      }
      if (input.decision.notorietyDeltaOnAttack <= 0) return;
      await this.recordRiskSignal(
        transaction,
        input.combatId,
        input.attackers[0]?.characterId,
        'UNLAWFUL_AGGRESSION',
        35,
        `pvp-risk-unlawful:${input.combatId}`,
        { notorietyDelta: input.decision.notorietyDeltaOnAttack },
      );
      for (const attacker of input.attackers) {
        await this.ensureProfile(transaction, attacker.characterId);
        await transaction.$executeRaw`
          UPDATE "PvpProfile"
          SET "notoriety" = LEAST(100, "notoriety" + ${input.decision.notorietyDeltaOnAttack}),
              "notorietyChangedAt" = NOW(),
              "updatedAt" = NOW()
          WHERE "characterId" = ${attacker.characterId}::uuid
        `;
      }
    });
  }

  async registerCombat(input: RegisterPvpCombatInput): Promise<PvpEngagementDecision> {
    const decision = await this.evaluateCombat(input);
    await this.recordApprovedCombat({ ...input, decision });
    return decision;
  }

  async recordObjectiveContribution(input: {
    combatId: string;
    characterId: string;
    operationId: string;
    objectivePoints: number;
    activeMs?: number;
    lateJoin?: boolean;
    disconnected?: boolean;
  }): Promise<void> {
    if (!/^[A-Za-z0-9:_-]{8,128}$/.test(input.operationId)) {
      throw new TypeError('PVP_CONTRIBUTION_OPERATION_INVALID');
    }
    if (
      !Number.isInteger(input.objectivePoints) ||
      input.objectivePoints < 0 ||
      input.objectivePoints > 100_000
    ) {
      throw new RangeError('PVP_CONTRIBUTION_POINTS_INVALID');
    }
    const activeMs = input.activeMs ?? 0;
    if (!Number.isInteger(activeMs) || activeMs < 0 || activeMs > 24 * 60 * 60_000) {
      throw new RangeError('PVP_CONTRIBUTION_ACTIVE_TIME_INVALID');
    }
    await this.prisma.$executeRaw`
      INSERT INTO "PvpObjectiveContribution"
        ("id", "combatId", "characterId", "operationId", "objectivePoints",
         "activeMs", "lateJoin", "disconnected", "createdAt")
      SELECT
        ${randomUUID()}::uuid, ${input.combatId}::uuid, ${input.characterId}::uuid,
        ${input.operationId}, ${input.objectivePoints}, ${activeMs},
        ${input.lateJoin ?? false}, ${input.disconnected ?? false}, NOW()
      WHERE EXISTS (
        SELECT 1 FROM "PvpCombat"
        WHERE "combatId" = ${input.combatId}::uuid AND "status" = 'ACTIVE'
      )
      ON CONFLICT ("characterId", "operationId") DO NOTHING
    `;
  }

  protected async getRepeatedOpponentState(
    transaction: Prisma.TransactionClient,
    attackers: readonly string[],
    defenders: readonly string[],
    now: number,
  ): Promise<{ count: number; lastDefeatedAt?: number }> {
    let maximum = 0;
    let latest: number | undefined;
    for (const attackerId of attackers) {
      for (const defenderId of defenders) {
        const rows = await transaction.$queryRaw<
          Array<{ count: bigint; lastDefeatedAt: Date | null }>
        >`
          SELECT COUNT(*)::bigint AS "count", MAX("defeatedAt") AS "lastDefeatedAt"
          FROM "PvpOpponentHistory"
          WHERE "winnerCharacterId" = ${attackerId}::uuid
            AND "loserCharacterId" = ${defenderId}::uuid
            AND "defeatedAt" >= ${new Date(now - 30 * 60_000)}
        `;
        maximum = Math.max(maximum, Number(rows[0]?.count ?? 0));
        const timestamp = rows[0]?.lastDefeatedAt?.getTime();
        if (timestamp !== undefined) latest = Math.max(latest ?? timestamp, timestamp);
      }
    }
    return { count: maximum, ...(latest !== undefined ? { lastDefeatedAt: latest } : {}) };
  }

  protected async requireAcceptedBounty(
    transaction: Prisma.TransactionClient,
    bountyId: string,
    attackers: readonly string[],
    defenders: readonly string[],
  ): Promise<BountyRow> {
    const rows = await transaction.$queryRaw<BountyRow[]>`
      SELECT * FROM "PvpBounty"
      WHERE "id" = ${bountyId}::uuid
        AND "status" = 'ACCEPTED'
        AND "expiresAt" > NOW()
      LIMIT 1
    `;
    const bounty = rows[0];
    if (
      !bounty ||
      !bounty.hunterCharacterId ||
      !attackers.includes(bounty.hunterCharacterId) ||
      !defenders.includes(bounty.targetCharacterId)
    ) {
      throw new Error('PVP_BOUNTY_NOT_AUTHORIZED');
    }
    return bounty;
  }

  protected async getRating(
    transaction: Prisma.TransactionClient,
    characterId: string,
    poolKey: string,
  ): Promise<PvpRatingRow> {
    await transaction.$executeRaw`
      INSERT INTO "PvpRating"
        ("characterId", "poolKey", "seasonKey", "rating", "uncertainty",
         "placementMatchesRemaining", "gamesPlayed", "updatedAt")
      VALUES
        (${characterId}::uuid, ${poolKey}, ${ACTIVE_SEASON.key}, 1000, 350, 5, 0, NOW())
      ON CONFLICT ("characterId", "poolKey", "seasonKey") DO NOTHING
    `;
    const rows = await transaction.$queryRaw<PvpRatingRow[]>`
      SELECT "rating", "uncertainty", "placementMatchesRemaining", "gamesPlayed"
      FROM "PvpRating"
      WHERE "characterId" = ${characterId}::uuid
        AND "poolKey" = ${poolKey}
        AND "seasonKey" = ${ACTIVE_SEASON.key}
      LIMIT 1
    `;
    return rows[0] ?? {
      rating: 1_000,
      uncertainty: 350,
      placementMatchesRemaining: 5,
      gamesPlayed: 0,
    };
  }

}
