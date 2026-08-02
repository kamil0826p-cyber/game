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
import { PvpServiceEconomy } from './pvp.service.economy.js';

export abstract class PvpServiceSettlement extends PvpServiceEconomy {
  async settleCombat(input: SettlePvpCombatInput): Promise<{ applied: boolean; checksum?: string }> {
    const finishedAt = input.finishedAt ?? Date.now();
    const contextRows = await this.prisma.$queryRaw<PvpCombatRow[]>`
      SELECT "combatId", "zoneType", "kind", "modeKey", "ratingPool", "attackerTeam",
             "defenderTeam", "legalAggression", "rewardMultiplier", "bountyId"
      FROM "PvpCombat"
      WHERE "combatId" = ${input.combatId}::uuid
      LIMIT 1
    `;
    const context = contextRows[0];
    if (!context || !input.winnerTeamId || !input.finishReason) return { applied: false };

    const replay: PvpReplayEnvelope = {
      combatId: input.combatId,
      rulesVersion: 1,
      ...(context.modeKey ? { modeKey: context.modeKey } : {}),
      events: input.events.map((event) => ({
        sequence: event.sequence,
        occurredAt: event.occurredAt,
        actorId: event.actorId,
        type: event.action,
        payload: {
          targetActorId: event.targetActorId,
          skillKey: event.skillKey,
          label: event.label,
          results: event.results,
        },
      })),
      winnerTeamId: input.winnerTeamId,
      finishReason: input.finishReason,
    };
    const checksum = pvpReplayChecksum(replay);

    return this.prisma.$transaction(async (transaction) => {
      const inserted = await transaction.$queryRaw<Array<{ combatId: string }>>`
        INSERT INTO "PvpCombatSettlement"
          ("combatId", "winnerTeamId", "finishReason", "payload", "settledAt")
        VALUES
          (${input.combatId}::uuid, ${input.winnerTeamId}, ${input.finishReason},
           ${JSON.stringify({ checksum })}::jsonb, ${new Date(finishedAt)})
        ON CONFLICT ("combatId") DO NOTHING
        RETURNING "combatId"
      `;
      if (!inserted[0]) return { applied: false, checksum };

      const winners = input.teams.find((team) => team.teamId === input.winnerTeamId)?.actorIds ?? [];
      const losers = input.teams.find((team) => team.teamId !== input.winnerTeamId)?.actorIds ?? [];
      const durationMs = Math.max(1, finishedAt - (input.startedAt ?? finishedAt));
      const contributionRows = await transaction.$queryRaw<PvpContributionAggregateRow[]>`
        SELECT
          "characterId",
          COALESCE(SUM("objectivePoints"), 0)::integer AS "objectivePoints",
          COALESCE(SUM("activeMs"), 0)::integer AS "activeMs",
          BOOL_OR("lateJoin") AS "lateJoin",
          BOOL_OR("disconnected") AS "disconnected"
        FROM "PvpObjectiveContribution"
        WHERE "combatId" = ${input.combatId}::uuid
        GROUP BY "characterId"
      `;
      const objectiveContribution = new Map(
        contributionRows.map((entry) => [entry.characterId, entry] as const),
      );
      const assessments = new Map(
        [...winners, ...losers].map((actorId) => {
          const contribution = this.contributionFromEvents(
            actorId,
            input.events,
            durationMs,
            objectiveContribution.get(actorId),
          );
          return [actorId, assessPvpContribution(contribution)] as const;
        }),
      );

      for (const actorId of [...winners, ...losers]) {
        await this.ensureProfile(transaction, actorId);
        const isLoser = losers.includes(actorId);
        await transaction.$executeRaw`
          UPDATE "PvpProfile"
          SET "defeatProtectedUntil" = ${
            isLoser ? new Date(finishedAt + PVP_DEFEAT_PROTECTION_MS) : null
          },
              "combatCooldownUntil" = ${new Date(finishedAt + PVP_COMBAT_COOLDOWN_MS)},
              "updatedAt" = NOW()
          WHERE "characterId" = ${actorId}::uuid
        `;
      }

      for (const winnerId of winners) {
        for (const loserId of losers) {
          await transaction.$executeRaw`
            INSERT INTO "PvpOpponentHistory"
              ("id", "winnerCharacterId", "loserCharacterId", "combatId", "defeatedAt")
            VALUES
              (${randomUUID()}::uuid, ${winnerId}::uuid, ${loserId}::uuid,
               ${input.combatId}::uuid, ${new Date(finishedAt)})
            ON CONFLICT ("combatId", "winnerCharacterId", "loserCharacterId") DO NOTHING
          `;
        }
      }

      if (context.ratingPool && context.modeKey) {
        const winnerRatings = await Promise.all(
          winners.map((actorId) => this.getRating(transaction, actorId, context.ratingPool!)),
        );
        const loserRatings = await Promise.all(
          losers.map((actorId) => this.getRating(transaction, actorId, context.ratingPool!)),
        );
        const winnerAverage = this.average(winnerRatings.map((entry) => entry.rating), 1_000);
        const loserAverage = this.average(loserRatings.map((entry) => entry.rating), 1_000);
        for (const [index, actorId] of winners.entries()) {
          const update = calculatePvpRatingUpdate(winnerRatings[index]!, loserAverage, 1);
          await this.persistRating(transaction, actorId, context.ratingPool, update);
        }
        for (const [index, actorId] of losers.entries()) {
          const update = calculatePvpRatingUpdate(loserRatings[index]!, winnerAverage, 0);
          await this.persistRating(transaction, actorId, context.ratingPool, update);
        }
      }

      for (const actorId of [...winners, ...losers]) {
        const assessment = assessments.get(actorId)!;
        const won = winners.includes(actorId);
        const baseRenown = won ? 25 : 10;
        const renown = assessment.eligible
          ? Math.round(baseRenown * Number(context.rewardMultiplier))
          : 0;
        await transaction.$executeRaw`
          INSERT INTO "PvpRewardLedger"
            ("id", "combatId", "characterId", "operationId", "renown", "cosmeticTokens",
             "eligible", "contribution", "createdAt")
          VALUES
            (${randomUUID()}::uuid, ${input.combatId}::uuid, ${actorId}::uuid,
             ${pvpSettlementOperationId(input.combatId, actorId)}, ${renown}, ${won && renown > 0 ? 1 : 0},
             ${assessment.eligible}, ${JSON.stringify(assessment)}::jsonb, ${new Date(finishedAt)})
          ON CONFLICT ("combatId", "characterId") DO NOTHING
        `;
      }

      if (context.bountyId) {
        await this.claimBounty(
          transaction,
          context.bountyId,
          winners,
          losers,
          assessments,
          input.combatId,
          finishedAt,
        );
      }

      await transaction.$executeRaw`
        INSERT INTO "PvpReplay"
          ("combatId", "rulesVersion", "modeKey", "checksum", "eventLog", "createdAt", "expiresAt")
        VALUES
          (${input.combatId}::uuid, 1, ${context.modeKey}, ${checksum},
           ${JSON.stringify(replay)}::jsonb, ${new Date(finishedAt)},
           ${new Date(finishedAt + 90 * 24 * 60 * 60_000)})
        ON CONFLICT ("combatId") DO NOTHING
      `;
      await this.enqueueOutbox(
        transaction,
        input.combatId,
        'PVP_COMBAT_SETTLED',
        `pvp-combat-settled:${input.combatId}`,
        {
          winnerTeamId: input.winnerTeamId,
          finishReason: input.finishReason,
          durationMs,
          modeKey: context.modeKey,
          ratingPool: context.ratingPool,
          rewardMultiplier: context.rewardMultiplier,
          eligibleParticipants: [...assessments.values()].filter((entry) => entry.eligible).length,
          checksum,
        },
      );
      if (/DISCONNECT|FORFEIT/i.test(input.finishReason ?? '')) {
        await this.recordRiskSignal(
          transaction,
          input.combatId,
          undefined,
          'DISCONNECT_OR_FORFEIT',
          25,
          `pvp-risk-forfeit:${input.combatId}`,
          { finishReason: input.finishReason },
        );
      }
      await transaction.$executeRaw`
        UPDATE "PvpCombat"
        SET "status" = 'SETTLED', "settledAt" = ${new Date(finishedAt)}
        WHERE "combatId" = ${input.combatId}::uuid
      `;
      return { applied: true, checksum };
    });
  }

  protected contributionFromEvents(
    actorId: string,
    events: readonly CombatActionResolutionPayload[],
    durationMs: number,
    objective?: PvpContributionAggregateRow,
  ) {
    let damage = 0;
    let healing = 0;
    let shielding = 0;
    let controlActions = 0;
    for (const event of events) {
      if (event.actorId !== actorId) continue;
      for (const result of event.results) {
        if (result.hpDelta < 0) damage += Math.abs(result.hpDelta);
        if (result.hpDelta > 0) healing += result.hpDelta;
        if (result.shieldDelta > 0) shielding += result.shieldDelta;
        controlActions += result.statusesApplied.filter((status) =>
          /stun|silence|root|taunt|mark|interrupt/i.test(status.key),
        ).length;
      }
    }
    return {
      characterId: actorId,
      activeMs: objective?.activeMs && objective.activeMs > 0
        ? Math.min(durationMs, objective.activeMs)
        : durationMs,
      matchDurationMs: durationMs,
      damage,
      healing,
      shielding,
      controlActions,
      objectivePoints: objective?.objectivePoints ?? 0,
      disconnected: objective?.disconnected ?? false,
      lateJoin: objective?.lateJoin ?? false,
    };
  }

}
