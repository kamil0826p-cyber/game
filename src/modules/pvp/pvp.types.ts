export type PvpZoneType = 'SAFE' | 'OUTLAW' | 'PVP';

export type PvpEngagementKind =
  | 'DUEL'
  | 'OPEN_WORLD'
  | 'BOUNTY'
  | 'RANKED'
  | 'OBJECTIVE';

export type PvpModeKey =
  | 'DUEL_1V1'
  | 'SKIRMISH_2V2'
  | 'SKIRMISH_3V3'
  | 'WARPARTY_5V5'
  | 'WARHOST_10V10'
  | 'CONTROL_RITUAL_5V5'
  | 'RELIC_HOLD_10V10';

export type PvpObjectiveKind = 'ELIMINATION' | 'CONTROL_RITUAL' | 'RELIC_HOLD';
export type PvpTieBreaker = 'OBJECTIVE_SCORE' | 'SURVIVORS' | 'TOTAL_HP_PERCENT' | 'SUDDEN_DEATH';
export type PvpDisconnectPolicy = 'FORFEIT_ACTOR' | 'FORFEIT_TEAM' | 'GRACE_THEN_FORFEIT';
export type PvpRewardProfile = 'DUEL' | 'RANKED_SMALL' | 'RANKED_LARGE' | 'OPEN_WORLD' | 'BOUNTY';

export interface PvpModeDefinition {
  key: PvpModeKey;
  version: number;
  engagementKind: Extract<PvpEngagementKind, 'DUEL' | 'RANKED' | 'OBJECTIVE'>;
  objective: PvpObjectiveKind;
  teamSize: 1 | 2 | 3 | 5 | 10;
  minTeamSize: 1 | 2 | 3 | 5 | 10;
  maxRounds: number;
  timeLimitMs: number;
  scoreToWin: number;
  tieBreaker: PvpTieBreaker;
  disconnectPolicy: PvpDisconnectPolicy;
  rewardProfile: PvpRewardProfile;
  ratingPool: string;
  normalized: boolean;
  allowedConsumableKeys: readonly string[];
}

export interface PvpPowerStats {
  maxHp: number;
  maxEnergy: number;
  strength: number;
  agility: number;
  intelligence: number;
  armor: number;
  magicResistance: number;
}

export interface PvpParticipantInput {
  characterId: string;
  userId: string;
  level: number;
  teamId: string;
  partySize: number;
  isPremade: boolean;
  optedIntoPvp: boolean;
  stats?: PvpPowerStats;
}

export interface PvpProtectionState {
  newcomerProtected: boolean;
  spawnProtectedUntil?: number;
  reconnectProtectedUntil?: number;
  defeatProtectedUntil?: number;
  combatCooldownUntil?: number;
  sameOpponentCooldownUntil?: number;
}

export interface PvpEngagementRequest {
  zoneType: PvpZoneType;
  kind: PvpEngagementKind;
  modeKey?: PvpModeKey;
  attackers: readonly PvpParticipantInput[];
  defenders: readonly PvpParticipantInput[];
  consented: boolean;
  activeBountyContract: boolean;
  rankedQueue: boolean;
  normalized: boolean;
  attackerProtection?: PvpProtectionState;
  defenderProtection?: PvpProtectionState;
  repeatedDefeatsInWindow: number;
}

export type PvpEngagementBlockReason =
  | 'EMPTY_TEAM'
  | 'TEAM_TOO_LARGE'
  | 'ROSTER_OVERLAP'
  | 'MODE_TEAM_SIZE'
  | 'SAFE_ZONE'
  | 'CONSENT_REQUIRED'
  | 'BOUNTY_REQUIRED'
  | 'NEWCOMER_PROTECTION'
  | 'SPAWN_PROTECTION'
  | 'RECONNECT_PROTECTION'
  | 'DEFEAT_PROTECTION'
  | 'COMBAT_COOLDOWN'
  | 'SAME_OPPONENT_COOLDOWN'
  | 'POWER_MISMATCH';

export interface PvpEngagementDecision {
  allowed: boolean;
  legalAggression: boolean;
  reason?: PvpEngagementBlockReason;
  notorietyDeltaOnAttack: number;
  rewardMultiplier: number;
  normalized: boolean;
}

export interface PvpRatingState {
  rating: number;
  uncertainty: number;
  placementMatchesRemaining: number;
  gamesPlayed: number;
}

export interface PvpRatingUpdate {
  previousRating: number;
  nextRating: number;
  delta: number;
  previousUncertainty: number;
  nextUncertainty: number;
  placementMatchesRemaining: number;
}

export interface PvpMatchmakingCandidate {
  characterId: string;
  rating: number;
  uncertainty: number;
  teamSize: number;
  partySize: number;
  isFullPremade: boolean;
  queuedAt: number;
  optedIntoPremadeMismatch: boolean;
}

export interface PvpMatchmakingDecision {
  compatible: boolean;
  reason?: 'TEAM_SIZE' | 'PREMADE_MISMATCH' | 'RATING_GAP';
  effectiveRatingGap: number;
  allowedRatingGap: number;
}

export interface PvpContribution {
  characterId: string;
  activeMs: number;
  matchDurationMs: number;
  damage: number;
  healing: number;
  shielding: number;
  controlActions: number;
  objectivePoints: number;
  disconnected: boolean;
  lateJoin: boolean;
}

export interface PvpContributionAssessment {
  eligible: boolean;
  score: number;
  participationRatio: number;
  supportScore: number;
  objectiveScore: number;
  reason?: 'AFK' | 'LATE_JOIN' | 'NO_CONTRIBUTION';
}

export interface PvpObjectiveState {
  modeKey: PvpModeKey;
  teamScores: Record<string, number>;
  teamRounds: Record<string, number>;
  relicHolderTeamId?: string;
  ritualControllerTeamId?: string;
  elapsedMs: number;
  finished: boolean;
  winnerTeamId?: string;
  finishReason?: 'SCORE_LIMIT' | 'TIME_LIMIT' | 'ELIMINATION';
}

export type PvpObjectiveEvent =
  | { type: 'ELIMINATION'; teamId: string; points?: number }
  | { type: 'RITUAL_CONTROL_TICK'; teamId: string; points?: number }
  | { type: 'RELIC_CAPTURED'; teamId: string }
  | { type: 'RELIC_HOLD_TICK'; teamId: string; points?: number }
  | { type: 'ROUND_WON'; teamId: string }
  | { type: 'TIME_ELAPSED'; elapsedMs: number };

export interface PvpNormalizationPreview {
  characterId: string;
  bracketLevel: number;
  powerBudget: number;
  original: PvpPowerStats;
  normalized: PvpPowerStats;
  retainedIdentityRatios: {
    offense: number;
    defense: number;
    utility: number;
  };
}

export interface PvpSeasonDefinition {
  key: string;
  version: number;
  startsAt: number;
  endsAt: number;
  modeKeys: readonly PvpModeKey[];
  minimumLeaderboardMatches: number;
  inactivityDecayAfterMs: number;
  rewardKeys: readonly string[];
}

export interface PvpReplayEvent {
  sequence: number;
  occurredAt: number;
  actorId: string;
  type: string;
  payload: Record<string, unknown>;
}

export interface PvpReplayEnvelope {
  combatId: string;
  rulesVersion: number;
  modeKey?: PvpModeKey;
  seed?: string;
  events: readonly PvpReplayEvent[];
  winnerTeamId?: string;
  finishReason?: string;
}
