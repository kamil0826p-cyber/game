import type { PvpContribution, PvpContributionAssessment, PvpMatchmakingCandidate, PvpMatchmakingDecision, PvpRatingState, PvpRatingUpdate } from './pvp.types.js';

export function calculatePvpRatingUpdate(
  state: PvpRatingState,
  opponentAverageRating: number,
  score: 0 | 0.5 | 1,
): PvpRatingUpdate {
  const expected = 1 / (1 + 10 ** ((opponentAverageRating - state.rating) / 400));
  const placementFactor = state.placementMatchesRemaining > 0 ? 1.8 : 1;
  const confidenceFactor = Math.min(1.5, Math.max(0.55, state.uncertainty / 350));
  const k = 32 * placementFactor * confidenceFactor;
  const delta = Math.round(k * (score - expected));
  const nextRating = Math.max(100, Math.min(3_000, state.rating + delta));
  const nextUncertainty = Math.max(60, Math.round(state.uncertainty * 0.92));
  return {
    previousRating: state.rating,
    nextRating,
    delta: nextRating - state.rating,
    previousUncertainty: state.uncertainty,
    nextUncertainty,
    placementMatchesRemaining: Math.max(0, state.placementMatchesRemaining - 1),
  };
}

export function softResetPvpRating(rating: number, anchor = 1_000): number {
  return Math.round(anchor + (rating - anchor) * 0.55);
}

export function evaluateMatchmaking(
  first: PvpMatchmakingCandidate,
  second: PvpMatchmakingCandidate,
  now: number,
): PvpMatchmakingDecision {
  if (first.teamSize !== second.teamSize) {
    return { compatible: false, reason: 'TEAM_SIZE', effectiveRatingGap: Infinity, allowedRatingGap: 0 };
  }
  const fullPremadeMismatch = first.isFullPremade !== second.isFullPremade;
  if (
    fullPremadeMismatch &&
    !(first.optedIntoPremadeMismatch && second.optedIntoPremadeMismatch)
  ) {
    return {
      compatible: false,
      reason: 'PREMADE_MISMATCH',
      effectiveRatingGap: Math.abs(first.rating - second.rating),
      allowedRatingGap: 0,
    };
  }
  const queuedMs = Math.min(now - first.queuedAt, now - second.queuedAt);
  const expansionSteps = Math.max(0, Math.floor(queuedMs / 30_000));
  const allowedRatingGap = Math.min(350, 100 + expansionSteps * 35);
  const uncertaintyAllowance = Math.round((first.uncertainty + second.uncertainty) * 0.15);
  const effectiveRatingGap = Math.max(
    0,
    Math.abs(first.rating - second.rating) - uncertaintyAllowance,
  );
  return effectiveRatingGap <= allowedRatingGap
    ? { compatible: true, effectiveRatingGap, allowedRatingGap }
    : { compatible: false, reason: 'RATING_GAP', effectiveRatingGap, allowedRatingGap };
}

export function assessPvpContribution(
  contribution: PvpContribution,
): PvpContributionAssessment {
  const participationRatio =
    contribution.matchDurationMs <= 0
      ? 0
      : Math.min(1, contribution.activeMs / contribution.matchDurationMs);
  const supportScore =
    contribution.healing * 0.65 + contribution.shielding * 0.5 + contribution.controlActions * 25;
  const objectiveScore = contribution.objectivePoints * 80;
  const score = Math.round(contribution.damage + supportScore + objectiveScore);
  if (contribution.lateJoin && participationRatio < 0.35) {
    return {
      eligible: false,
      score,
      participationRatio,
      supportScore,
      objectiveScore,
      reason: 'LATE_JOIN',
    };
  }
  if (participationRatio < 0.25) {
    return {
      eligible: false,
      score,
      participationRatio,
      supportScore,
      objectiveScore,
      reason: 'AFK',
    };
  }
  if (score <= 0) {
    return {
      eligible: false,
      score,
      participationRatio,
      supportScore,
      objectiveScore,
      reason: 'NO_CONTRIBUTION',
    };
  }
  return { eligible: true, score, participationRatio, supportScore, objectiveScore };
}
