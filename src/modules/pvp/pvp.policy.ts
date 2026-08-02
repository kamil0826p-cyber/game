import type { PvpEngagementDecision, PvpEngagementRequest } from './pvp.types.js';
import { PVP_MAX_UNNORMALIZED_LEVEL_GAP, PVP_TEAM_LIMIT } from './pvp.constants.js';
import { getPvpModeDefinition } from './pvp.modes.js';

function blocked(
  reason: NonNullable<PvpEngagementDecision['reason']>,
  normalized: boolean,
): PvpEngagementDecision {
  return {
    allowed: false,
    legalAggression: false,
    reason,
    notorietyDeltaOnAttack: 0,
    rewardMultiplier: 0,
    normalized,
  };
}

function hasActiveProtection(
  request: PvpEngagementRequest,
  now: number,
): PvpEngagementDecision['reason'] | undefined {
  const protection = request.defenderProtection;
  if (!protection) return undefined;
  if (protection.newcomerProtected && !request.defenders.every((entry) => entry.optedIntoPvp)) {
    return 'NEWCOMER_PROTECTION';
  }
  if ((protection.spawnProtectedUntil ?? 0) > now) return 'SPAWN_PROTECTION';
  if ((protection.reconnectProtectedUntil ?? 0) > now) return 'RECONNECT_PROTECTION';
  if ((protection.defeatProtectedUntil ?? 0) > now) return 'DEFEAT_PROTECTION';
  if ((protection.combatCooldownUntil ?? 0) > now) return 'COMBAT_COOLDOWN';
  if ((protection.sameOpponentCooldownUntil ?? 0) > now) return 'SAME_OPPONENT_COOLDOWN';
  return undefined;
}

function averageLevel(entries: PvpEngagementRequest['attackers']): number {
  if (entries.length === 0) return 0;
  return entries.reduce((sum, entry) => sum + entry.level, 0) / entries.length;
}

function legalByContext(request: PvpEngagementRequest): boolean {
  return (
    request.kind === 'RANKED' ||
    request.kind === 'OBJECTIVE' ||
    (request.kind === 'DUEL' && request.consented) ||
    (request.kind === 'BOUNTY' && request.activeBountyContract)
  );
}

export function evaluatePvpEngagement(
  request: PvpEngagementRequest,
  now: number,
): PvpEngagementDecision {
  const normalized = request.normalized || Boolean(request.modeKey && getPvpModeDefinition(request.modeKey).normalized);
  if (request.attackers.length === 0 || request.defenders.length === 0) {
    return blocked('EMPTY_TEAM', normalized);
  }
  if (request.attackers.length > PVP_TEAM_LIMIT || request.defenders.length > PVP_TEAM_LIMIT) {
    return blocked('TEAM_TOO_LARGE', normalized);
  }
  const attackerIds = new Set(request.attackers.map((entry) => entry.characterId));
  if (request.defenders.some((entry) => attackerIds.has(entry.characterId))) {
    return blocked('ROSTER_OVERLAP', normalized);
  }
  if (request.modeKey) {
    const mode = getPvpModeDefinition(request.modeKey);
    if (
      request.attackers.length < mode.minTeamSize ||
      request.defenders.length < mode.minTeamSize ||
      request.attackers.length > mode.teamSize ||
      request.defenders.length > mode.teamSize
    ) {
      return blocked('MODE_TEAM_SIZE', normalized);
    }
  }

  const contextualLegal = legalByContext(request);
  if (request.zoneType === 'SAFE' && !contextualLegal) {
    return blocked('SAFE_ZONE', normalized);
  }
  if (
    (request.zoneType === 'SAFE' || request.zoneType === 'OUTLAW') &&
    request.kind === 'DUEL' &&
    !request.consented
  ) {
    return blocked('CONSENT_REQUIRED', normalized);
  }
  if (request.kind === 'BOUNTY' && !request.activeBountyContract) {
    return blocked('BOUNTY_REQUIRED', normalized);
  }

  const bypassProtection = request.kind === 'RANKED' || request.kind === 'OBJECTIVE';
  if (!bypassProtection) {
    const protectionReason = hasActiveProtection(request, now);
    if (protectionReason) return blocked(protectionReason, normalized);
  }

  const levelGap = Math.abs(averageLevel(request.attackers) - averageLevel(request.defenders));
  if (
    !normalized &&
    request.kind !== 'BOUNTY' &&
    levelGap > PVP_MAX_UNNORMALIZED_LEVEL_GAP
  ) {
    return blocked('POWER_MISMATCH', normalized);
  }

  const lawful = contextualLegal || request.zoneType === 'PVP';
  const unlawfulOutlawAttack = request.zoneType === 'OUTLAW' && request.kind === 'OPEN_WORLD';
  return {
    allowed: true,
    legalAggression: lawful && !unlawfulOutlawAttack,
    notorietyDeltaOnAttack: unlawfulOutlawAttack ? 12 : 0,
    rewardMultiplier: repeatOpponentRewardMultiplier(request.repeatedDefeatsInWindow),
    normalized,
  };
}

export function repeatOpponentRewardMultiplier(repeatedDefeatsInWindow: number): number {
  if (repeatedDefeatsInWindow <= 0) return 1;
  if (repeatedDefeatsInWindow === 1) return 0.35;
  return 0;
}

export function reduceNotoriety(current: number, elapsedMs: number, redemptionPoints = 0): number {
  const timeReduction = Math.floor(Math.max(0, elapsedMs) / (30 * 60_000));
  return Math.max(0, Math.floor(current) - timeReduction - Math.max(0, Math.floor(redemptionPoints)));
}

export function notorietyTier(value: number): 'NONE' | 'AGGRESSOR' | 'OUTLAW' | 'HUNTED' {
  if (value <= 0) return 'NONE';
  if (value < 20) return 'AGGRESSOR';
  if (value < 50) return 'OUTLAW';
  return 'HUNTED';
}
