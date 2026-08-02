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
import { PvpServiceBounty } from './pvp.service.bounty.js';

export class PvpServiceReplay extends PvpServiceBounty {
  async getReplay(
    userId: string,
    characterId: string,
    combatId: string,
  ): Promise<{ checksum: string; replay: unknown }> {
    await this.requireOwnedCharacter(this.prisma, userId, characterId);
    const combatRows = await this.prisma.$queryRaw<PvpCombatRow[]>`
      SELECT "combatId", "zoneType", "kind", "modeKey", "ratingPool", "attackerTeam",
             "defenderTeam", "legalAggression", "rewardMultiplier", "bountyId"
      FROM "PvpCombat"
      WHERE "combatId" = ${combatId}::uuid
      LIMIT 1
    `;
    const combat = combatRows[0];
    if (!combat) throw new Error('PVP_REPLAY_NOT_FOUND');
    const participants = [
      ...this.stringArray(combat.attackerTeam),
      ...this.stringArray(combat.defenderTeam),
    ];
    if (!participants.includes(characterId)) throw new Error('PVP_REPLAY_FORBIDDEN');
    const rows = await this.prisma.$queryRaw<Array<{ checksum: string; eventLog: unknown }>>`
      SELECT "checksum", "eventLog"
      FROM "PvpReplay"
      WHERE "combatId" = ${combatId}::uuid
        AND "expiresAt" > NOW()
      LIMIT 1
    `;
    if (!rows[0]) throw new Error('PVP_REPLAY_NOT_FOUND');
    return { checksum: rows[0].checksum, replay: rows[0].eventLog };
  }

  async reportCombat(input: {
    userId: string;
    characterId: string;
    combatId: string;
    category: 'GRIEFING' | 'WINTRADING' | 'AFK' | 'SPAWN_CAMPING' | 'OTHER';
    operationId: string;
  }): Promise<{ reportId: string }> {
    return this.prisma.$transaction(async (transaction) => {
      await this.requireOwnedCharacter(transaction, input.userId, input.characterId);
      const reportId = randomUUID();
      const inserted = await transaction.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "PvpReport"
          ("id", "combatId", "reporterCharacterId", "category", "operationId", "createdAt")
        SELECT ${reportId}::uuid, ${input.combatId}::uuid, ${input.characterId}::uuid,
               ${input.category}, ${input.operationId}, NOW()
        WHERE EXISTS (
          SELECT 1
          FROM "PvpCombat"
          WHERE "combatId" = ${input.combatId}::uuid
            AND (
              "attackerTeam" @> ${JSON.stringify([input.characterId])}::jsonb
              OR "defenderTeam" @> ${JSON.stringify([input.characterId])}::jsonb
            )
        )
        ON CONFLICT ("reporterCharacterId", "operationId") DO UPDATE
          SET "operationId" = EXCLUDED."operationId"
        RETURNING "id"
      `;
      const result = inserted[0];
      if (!result) throw new Error('PVP_REPORT_COMBAT_NOT_FOUND');
      await this.recordRiskSignal(
        transaction,
        input.combatId,
        input.characterId,
        `PLAYER_REPORT_${input.category}`,
        input.category === 'WINTRADING' || input.category === 'SPAWN_CAMPING' ? 60 : 40,
        `pvp-risk-report:${result.id}`,
        { reportId: result.id, category: input.category },
      );
      await this.enqueueOutbox(
        transaction,
        input.combatId,
        'PVP_COMBAT_REPORTED',
        `pvp-report:${result.id}`,
        { reportId: result.id, reporterCharacterId: input.characterId, category: input.category },
      );
      return { reportId: result.id };
    });
  }

}
