import { describe, expect, it } from 'vitest';
import {
  applyObjectiveEvent,
  assessPvpContribution,
  calculatePvpRatingUpdate,
  createObjectiveState,
  evaluateMatchmaking,
  evaluatePvpEngagement,
  getPvpModeDefinition,
  listPvpModes,
  previewPvpNormalization,
  pvpReplayChecksum,
  repeatOpponentRewardMultiplier,
  softResetPvpRating,
  validatePvpSeason,
} from '../src/modules/pvp/pvp.rules.js';
import type {
  PvpEngagementRequest,
  PvpMatchmakingCandidate,
  PvpParticipantInput,
} from '../src/modules/pvp/pvp.types.js';

const participant = (
  characterId: string,
  teamId: string,
  level = 30,
  overrides: Partial<PvpParticipantInput> = {},
): PvpParticipantInput => ({
  characterId,
  userId: `user-${characterId}`,
  level,
  teamId,
  partySize: 1,
  isPremade: false,
  optedIntoPvp: true,
  ...overrides,
});

const engagement = (
  overrides: Partial<PvpEngagementRequest> = {},
): PvpEngagementRequest => ({
  zoneType: 'PVP',
  kind: 'OPEN_WORLD',
  attackers: [participant('a', 'red')],
  defenders: [participant('b', 'blue')],
  consented: false,
  activeBountyContract: false,
  rankedQueue: false,
  normalized: false,
  repeatedDefeatsInWindow: 0,
  ...overrides,
});

const queueCandidate = (
  characterId: string,
  overrides: Partial<PvpMatchmakingCandidate> = {},
): PvpMatchmakingCandidate => ({
  characterId,
  rating: 1_000,
  uncertainty: 200,
  teamSize: 10,
  partySize: 1,
  isFullPremade: false,
  queuedAt: 1_000,
  optedIntoPremadeMismatch: false,
  ...overrides,
});

describe('PvP rules', () => {
  it('keeps SAFE, OUTLAW and PVP semantics explicit', () => {
    expect(evaluatePvpEngagement(engagement({ zoneType: 'SAFE' }), 10_000)).toMatchObject({
      allowed: false,
      reason: 'SAFE_ZONE',
    });
    expect(
      evaluatePvpEngagement(
        engagement({ zoneType: 'SAFE', kind: 'DUEL', consented: true }),
        10_000,
      ),
    ).toMatchObject({ allowed: true, legalAggression: true });
    expect(
      evaluatePvpEngagement(engagement({ zoneType: 'OUTLAW' }), 10_000),
    ).toMatchObject({
      allowed: true,
      legalAggression: false,
      notorietyDeltaOnAttack: 12,
    });
    expect(evaluatePvpEngagement(engagement({ zoneType: 'PVP' }), 10_000)).toMatchObject({
      allowed: true,
      legalAggression: true,
    });
  });

  it('supports declared modes from 1v1 to 10v10 and an objective finish', () => {
    const sizes = new Set(listPvpModes().map((mode) => mode.teamSize));
    expect([...sizes].sort((a, b) => a - b)).toEqual([1, 2, 3, 5, 10]);
    expect(getPvpModeDefinition('CONTROL_RITUAL_5V5').objective).toBe('CONTROL_RITUAL');

    let state = createObjectiveState('CONTROL_RITUAL_5V5', ['red', 'blue']);
    state = applyObjectiveEvent(state, {
      type: 'RITUAL_CONTROL_TICK',
      teamId: 'red',
      points: 100,
    });
    expect(state).toMatchObject({
      finished: true,
      winnerTeamId: 'red',
      finishReason: 'SCORE_LIMIT',
    });
  });

  it('rejects invalid mode rosters and teams larger than ten', () => {
    expect(
      evaluatePvpEngagement(
        engagement({
          kind: 'RANKED',
          modeKey: 'WARHOST_10V10',
          normalized: true,
          rankedQueue: true,
        }),
        10_000,
      ),
    ).toMatchObject({ allowed: false, reason: 'MODE_TEAM_SIZE' });

    const attackers = Array.from({ length: 11 }, (_, index) =>
      participant(`a-${index}`, 'red'),
    );
    expect(evaluatePvpEngagement(engagement({ attackers }), 10_000)).toMatchObject({
      allowed: false,
      reason: 'TEAM_TOO_LARGE',
    });
  });

  it('blocks newcomer, spawn, reconnect, defeat and repeat-target griefing windows', () => {
    expect(
      evaluatePvpEngagement(
        engagement({
          defenders: [participant('new', 'blue', 5, { optedIntoPvp: false })],
          defenderProtection: { newcomerProtected: true },
        }),
        10_000,
      ),
    ).toMatchObject({ allowed: false, reason: 'NEWCOMER_PROTECTION' });

    for (const [field, reason] of [
      ['spawnProtectedUntil', 'SPAWN_PROTECTION'],
      ['reconnectProtectedUntil', 'RECONNECT_PROTECTION'],
      ['defeatProtectedUntil', 'DEFEAT_PROTECTION'],
      ['combatCooldownUntil', 'COMBAT_COOLDOWN'],
      ['sameOpponentCooldownUntil', 'SAME_OPPONENT_COOLDOWN'],
    ] as const) {
      expect(
        evaluatePvpEngagement(
          engagement({
            defenderProtection: { newcomerProtected: false, [field]: 20_000 },
          }),
          10_000,
        ),
      ).toMatchObject({ allowed: false, reason });
    }
  });

  it('removes rewards from repeated farming while keeping the combat result valid', () => {
    expect(repeatOpponentRewardMultiplier(0)).toBe(1);
    expect(repeatOpponentRewardMultiplier(1)).toBe(0.35);
    expect(repeatOpponentRewardMultiplier(2)).toBe(0);
    expect(
      evaluatePvpEngagement(engagement({ repeatedDefeatsInWindow: 3 }), 10_000),
    ).toMatchObject({ allowed: true, rewardMultiplier: 0 });
  });

  it('protects solo players from an unconsented full premade mismatch', () => {
    const solo = queueCandidate('solo');
    const premade = queueCandidate('stack', {
      partySize: 10,
      isFullPremade: true,
    });
    expect(evaluateMatchmaking(solo, premade, 20_000)).toMatchObject({
      compatible: false,
      reason: 'PREMADE_MISMATCH',
    });
    expect(
      evaluateMatchmaking(
        { ...solo, optedIntoPremadeMismatch: true },
        { ...premade, optedIntoPremadeMismatch: true },
        20_000,
      ).compatible,
    ).toBe(true);
  });

  it('expands rating tolerance with queue time but keeps a hard cap', () => {
    const first = queueCandidate('a', { rating: 1_000, queuedAt: 0 });
    const second = queueCandidate('b', { rating: 1_500, queuedAt: 0 });
    const early = evaluateMatchmaking(first, second, 5_000);
    const late = evaluateMatchmaking(first, second, 15 * 60_000);
    expect(early.compatible).toBe(false);
    expect(late.allowedRatingGap).toBe(350);
    expect(late.compatible).toBe(false);
  });

  it('updates rating deterministically and uses a soft seasonal reset', () => {
    const update = calculatePvpRatingUpdate(
      { rating: 1_000, uncertainty: 350, placementMatchesRemaining: 5, gamesPlayed: 0 },
      1_000,
      1,
    );
    expect(update.delta).toBeGreaterThan(20);
    expect(update.placementMatchesRemaining).toBe(4);
    expect(update.nextUncertainty).toBeLessThan(350);
    expect(softResetPvpRating(2_000)).toBe(1_550);
  });

  it('keeps build identity while constraining the ranked power budget', () => {
    const preview = previewPvpNormalization('a', 80, {
      maxHp: 2_000,
      maxEnergy: 200,
      strength: 300,
      agility: 100,
      intelligence: 50,
      armor: 250,
      magicResistance: 150,
    });
    expect(preview.bracketLevel).toBe(50);
    expect(preview.normalized.maxHp).toBeLessThan(preview.original.maxHp);
    expect(preview.retainedIdentityRatios.offense).toBeGreaterThan(0);
  });

  it('counts support and objective play toward reward eligibility', () => {
    expect(
      assessPvpContribution({
        characterId: 'support',
        activeMs: 50_000,
        matchDurationMs: 60_000,
        damage: 0,
        healing: 600,
        shielding: 400,
        controlActions: 2,
        objectivePoints: 3,
        disconnected: false,
        lateJoin: false,
      }),
    ).toMatchObject({ eligible: true });
    expect(
      assessPvpContribution({
        characterId: 'afk',
        activeMs: 5_000,
        matchDurationMs: 60_000,
        damage: 1,
        healing: 0,
        shielding: 0,
        controlActions: 0,
        objectivePoints: 0,
        disconnected: false,
        lateJoin: false,
      }),
    ).toMatchObject({ eligible: false, reason: 'AFK' });
  });

  it('forbids permanent power rewards in a season definition', () => {
    expect(() =>
      validatePvpSeason({
        key: 'season-1',
        version: 1,
        startsAt: 1,
        endsAt: 2,
        modeKeys: ['DUEL_1V1'],
        minimumLeaderboardMatches: 10,
        inactivityDecayAfterMs: 14 * 24 * 60 * 60_000,
        rewardKeys: ['title:ash-crowned', 'heraldry:black-sun'],
      }),
    ).not.toThrow();
    expect(() =>
      validatePvpSeason({
        key: 'season-2',
        version: 1,
        startsAt: 1,
        endsAt: 2,
        modeKeys: ['DUEL_1V1'],
        minimumLeaderboardMatches: 10,
        inactivityDecayAfterMs: 14 * 24 * 60 * 60_000,
        rewardKeys: ['power-damage-boost'],
      }),
    ).toThrow('PVP_SEASON_POWER_REWARD_FORBIDDEN');
  });

  it('produces a deterministic replay checksum', () => {
    const replay = {
      combatId: '00000000-0000-4000-8000-000000000001',
      rulesVersion: 1,
      modeKey: 'DUEL_1V1' as const,
      events: [
        {
          sequence: 1,
          occurredAt: 100,
          actorId: 'a',
          type: 'ACTION',
          payload: { damage: 10, target: 'b' },
        },
      ],
      winnerTeamId: 'red',
      finishReason: 'DEFEATED',
    };
    expect(pvpReplayChecksum(replay)).toBe(pvpReplayChecksum(structuredClone(replay)));
    expect(
      pvpReplayChecksum({
        ...replay,
        events: [{ ...replay.events[0]!, payload: { damage: 11, target: 'b' } }],
      }),
    ).not.toBe(pvpReplayChecksum(replay));
  });
});
