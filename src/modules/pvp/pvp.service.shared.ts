import type { CombatActionResolutionPayload } from '../../contracts/socket.events.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { listPvpModes, notorietyTier } from './pvp.rules.js';
import type {
  PvpEngagementDecision,
  PvpEngagementKind,
  PvpModeKey,
  PvpPowerStats,
  PvpZoneType,
} from './pvp.types.js';

export const BOUNTY_MIN_SILVER = 100;
export const BOUNTY_MAX_SILVER = 100_000;
export const BOUNTY_MIN_DURATION_MS = 60 * 60_000;
export const BOUNTY_MAX_DURATION_MS = 7 * 24 * 60 * 60_000;
export const BOUNTY_CREATE_LIMIT_PER_DAY = 5;
export const MAX_CURRENCY_AMOUNT = 2_147_483_647;
export const ACTIVE_SEASON = {
  key: 'ash-crown-preseason',
  version: 1,
  startsAt: Date.UTC(2026, 7, 1),
  endsAt: Date.UTC(2026, 9, 1),
  minimumLeaderboardMatches: 10,
  inactivityDecayAfterMs: 14 * 24 * 60 * 60_000,
  rewardKeys: ['title:ash-crowned', 'heraldry:black-sun', 'chronicle:preseason'],
} as const;

export interface PvpProfileRow {
  characterId: string;
  optedIn: boolean;
  notoriety: number;
  notorietyChangedAt: Date;
  spawnProtectedUntil: Date | null;
  reconnectProtectedUntil: Date | null;
  defeatProtectedUntil: Date | null;
  combatCooldownUntil: Date | null;
}

export interface PvpCombatRow {
  combatId: string;
  zoneType: PvpZoneType;
  kind: PvpEngagementKind;
  modeKey: PvpModeKey | null;
  ratingPool: string | null;
  attackerTeam: unknown;
  defenderTeam: unknown;
  legalAggression: boolean;
  rewardMultiplier: number;
  bountyId: string | null;
}

export interface PvpRatingRow {
  rating: number;
  uncertainty: number;
  placementMatchesRemaining: number;
  gamesPlayed: number;
}

export interface PvpContributionAggregateRow {
  characterId: string;
  objectivePoints: number;
  activeMs: number;
  lateJoin: boolean;
  disconnected: boolean;
}

export interface BountyRow {
  id: string;
  targetCharacterId: string;
  creatorCharacterId: string | null;
  hunterCharacterId: string | null;
  amountSilver: number;
  feeSilver: number;
  status: 'OPEN' | 'ACCEPTED' | 'CLAIMED' | 'CANCELLED' | 'EXPIRED';
  expiresAt: Date;
  createdAt: Date;
  targetName?: string;
  targetLevel?: number;
  regionKey?: string | null;
}

export interface PvpBountyView {
  id: string;
  targetCharacterId: string;
  targetName: string;
  targetLevel: number;
  amountSilver: number;
  status: BountyRow['status'];
  expiresAt: number;
  acceptedByMe: boolean;
  createdByMe: boolean;
  regionHint?: string;
}

export interface PvpOverview {
  rulesVersion: number;
  profile: {
    optedIn: boolean;
    notoriety: number;
    notorietyTier: ReturnType<typeof notorietyTier>;
    consequences: {
      merchantSurchargePercent: number;
      guardedNpcServicesBlocked: boolean;
      guardedPortalBlocked: boolean;
      visibleToBountyHunters: boolean;
    };
    protections: {
      spawnUntil?: number;
      reconnectUntil?: number;
      defeatUntil?: number;
      combatCooldownUntil?: number;
    };
  };
  activeSeason: typeof ACTIVE_SEASON;
  modes: ReturnType<typeof listPvpModes>;
  bounties: PvpBountyView[];
}

export interface RegisterPvpCombatInput {
  combatId: string;
  mapId: string;
  zoneType: PvpZoneType;
  kind: PvpEngagementKind;
  modeKey?: PvpModeKey;
  attackers: readonly PlayerSession[];
  defenders: readonly PlayerSession[];
  consented: boolean;
  bountyId?: string;
  normalized?: boolean;
  now?: number;
}

export interface EvaluatePvpCombatInput extends Omit<RegisterPvpCombatInput, 'combatId' | 'mapId'> {}

export interface ApprovedPvpCombatInput extends RegisterPvpCombatInput {
  decision: PvpEngagementDecision;
}

export interface SettlePvpCombatInput {
  combatId: string;
  winnerTeamId?: string;
  finishReason?: string;
  teams: readonly [
    { teamId: string; actorIds: readonly string[] },
    { teamId: string; actorIds: readonly string[] },
  ];
  events: readonly CombatActionResolutionPayload[];
  startedAt?: number;
  finishedAt?: number;
}

export class PvpPolicyViolationError extends Error {
  constructor(readonly reason: NonNullable<PvpEngagementDecision['reason']>) {
    super(`PVP_${reason}`);
    this.name = 'PvpPolicyViolationError';
  }
}
