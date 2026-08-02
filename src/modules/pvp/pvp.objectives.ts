import type { PvpModeKey, PvpObjectiveEvent, PvpObjectiveState } from './pvp.types.js';
import { getPvpModeDefinition } from './pvp.modes.js';

export function createObjectiveState(
  modeKey: PvpModeKey,
  teamIds: readonly string[],
): PvpObjectiveState {
  return {
    modeKey,
    teamScores: Object.fromEntries(teamIds.map((teamId) => [teamId, 0])),
    teamRounds: Object.fromEntries(teamIds.map((teamId) => [teamId, 0])),
    elapsedMs: 0,
    finished: false,
  };
}

function topTeam(scores: Record<string, number>): string | undefined {
  const ordered = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!ordered[0]) return undefined;
  if (ordered[1] && ordered[1][1] === ordered[0][1]) return undefined;
  return ordered[0][0];
}

export function applyObjectiveEvent(
  state: PvpObjectiveState,
  event: PvpObjectiveEvent,
): PvpObjectiveState {
  if (state.finished) return state;
  const mode = getPvpModeDefinition(state.modeKey);
  const next: PvpObjectiveState = {
    ...state,
    teamScores: { ...state.teamScores },
    teamRounds: { ...state.teamRounds },
  };
  if (event.type === 'TIME_ELAPSED') {
    next.elapsedMs += Math.max(0, event.elapsedMs);
  } else if (event.type === 'RELIC_CAPTURED') {
    next.relicHolderTeamId = event.teamId;
  } else if (event.type === 'RELIC_HOLD_TICK') {
    if (next.relicHolderTeamId === event.teamId) {
      next.teamScores[event.teamId] = (next.teamScores[event.teamId] ?? 0) + (event.points ?? 1);
    }
  } else if (event.type === 'RITUAL_CONTROL_TICK') {
    next.ritualControllerTeamId = event.teamId;
    next.teamScores[event.teamId] = (next.teamScores[event.teamId] ?? 0) + (event.points ?? 1);
  } else if (event.type === 'ELIMINATION') {
    next.teamScores[event.teamId] = (next.teamScores[event.teamId] ?? 0) + (event.points ?? 1);
  } else if (event.type === 'ROUND_WON') {
    next.teamRounds[event.teamId] = (next.teamRounds[event.teamId] ?? 0) + 1;
  }

  const scoreLeader = topTeam(next.teamScores);
  const roundLeader = topTeam(next.teamRounds);
  if (scoreLeader && next.teamScores[scoreLeader]! >= mode.scoreToWin) {
    next.finished = true;
    next.winnerTeamId = scoreLeader;
    next.finishReason = mode.objective === 'ELIMINATION' ? 'ELIMINATION' : 'SCORE_LIMIT';
  } else if (roundLeader && next.teamRounds[roundLeader]! >= mode.scoreToWin) {
    next.finished = true;
    next.winnerTeamId = roundLeader;
    next.finishReason = 'ELIMINATION';
  } else if (next.elapsedMs >= mode.timeLimitMs) {
    next.finished = true;
    next.winnerTeamId = topTeam(next.teamScores) ?? topTeam(next.teamRounds);
    next.finishReason = 'TIME_LIMIT';
  }
  return next;
}
