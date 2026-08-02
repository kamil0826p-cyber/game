import { describe, expect, it } from 'vitest';
import {
  applyRegionContribution,
  assertBankWithdrawal,
  assertOperationReplay,
  assertFinderPartySize,
  contractProgress,
  effectiveRegionContribution,
  finderMissingRequirements,
  freezeFinderListing,
  mentorshipCompletionAllowed,
  metricFillRate,
  projectStageProgress,
  rewardConcentration,
  guildLevelForExperience,
  updateFinderReadiness,
} from '../src/modules/social/social.engine.js';
import type {
  FinderListingState,
  FinderMemberState,
  GuildContractInstanceState,
  GuildProjectInstanceState,
  MentorshipState,
  RegionGoalState,
} from '../src/modules/social/social.types.js';

const member = (index: number, ready = true): FinderMemberState => ({
  characterId: `character-${index}`,
  userId: `user-${index}`,
  name: `Player ${index}`,
  level: 10,
  characterClass: index % 2 === 0 ? 'MAGE' : 'WARRIOR',
  functions: index % 2 === 0 ? ['INTERRUPT'] : ['PROTECTION'],
  formation: index % 2 === 0 ? 'BACK' : 'FRONT',
  loadoutReady: ready,
  requirementsMet: ready,
  riskAccepted: ready,
  consumableSummary: [],
  reconnectStatus: 'ONLINE',
});

const listing = (size: number, ready = true): FinderListingState => ({
  id: 'listing-1',
  ownerCharacterId: 'character-1',
  realmId: 'realm-1',
  activityType: 'EXPEDITION',
  activityKey: 'expedition:ashen-pilgrimage',
  title: 'Ashen Pilgrimage',
  minimumSize: size,
  maximumSize: size,
  levelHint: { minimum: 5 },
  requestedFunctions: ['INTERRUPT', 'PROTECTION'],
  language: 'pl',
  expectedMinutes: 45,
  riskProfile: 'STANDARD',
  requirements: { minimumLevel: 5 },
  acceptancePolicy: 'MANUAL',
  decisionPolicy: 'LEADER',
  status: 'LOBBY',
  members: Array.from({ length: size }, (_, index) => member(index + 1, ready)),
  applicants: [],
  frozenCharacterIds: [],
  createdAt: '2026-08-02T08:00:00.000Z',
  updatedAt: '2026-08-02T08:00:00.000Z',
  revision: 0,
});

describe('social framework', () => {
  it('accepts every legal finder party size from one to ten and rejects overflow', () => {
    for (let size = 1; size <= 10; size += 1) {
      expect(() => assertFinderPartySize(size, size)).not.toThrow();
      expect(freezeFinderListing(listing(size), '2026-08-02T08:01:00.000Z').frozenCharacterIds)
        .toHaveLength(size);
    }
    expect(() => assertFinderPartySize(0, 1)).toThrow('SOCIAL_PARTY_SIZE_INVALID');
    expect(() => assertFinderPartySize(1, 11)).toThrow('SOCIAL_PARTY_SIZE_INVALID');
  });

  it('uses declared build functions without class gates', () => {
    const source = listing(2);
    source.members[0]!.characterClass = 'MAGE';
    source.members[0]!.functions = ['PROTECTION'];
    source.members[1]!.characterClass = 'WARRIOR';
    source.members[1]!.functions = ['CLEANSE'];
    expect(finderMissingRequirements(source)).toEqual([]);
  });

  it('blocks atomic roster freeze until formation loadout requirements and risk are ready', () => {
    const source = listing(2, false);
    expect(finderMissingRequirements(source)).toEqual([
      'ENTRY_REQUIREMENTS',
      'LOADOUT',
      'RISK_ACCEPTANCE',
    ]);
    expect(() => freezeFinderListing(source, '2026-08-02T08:01:00.000Z')).toThrow(
      'SOCIAL_READY_CHECK_FAILED',
    );
    const ready = source.members.reduce(
      (current, currentMember) => updateFinderReadiness(
        current,
        currentMember.characterId,
        {
          functions: currentMember.functions,
          formation: currentMember.formation,
          loadoutReady: true,
          requirementsMet: true,
          riskAccepted: true,
          consumableSummary: ['healing-tonic'],
        },
        '2026-08-02T08:01:00.000Z',
      ),
      source,
    );
    expect(freezeFinderListing(ready, '2026-08-02T08:02:00.000Z').status).toBe('FROZEN');
  });

  it('counts only qualified non-AFK contract contribution with character and account caps', () => {
    const contract: GuildContractInstanceState = {
      id: 'contract-1',
      definitionKey: 'ashen-ward',
      definitionVersion: 1,
      snapshot: {
        title: 'Ashen Ward',
        target: 100,
        rewardXp: 25,
        contributionKinds: ['ACTIVITY', 'REGION'],
        perCharacterCap: 40,
        perAccountCap: 50,
      },
      status: 'ACTIVE',
      startsAt: '2026-08-02T00:00:00.000Z',
      endsAt: '2026-08-09T00:00:00.000Z',
      contributions: [
        { operationId: 'a', characterId: 'c1', userId: 'u1', kind: 'ACTIVITY', amount: 30, qualified: true, afk: false, sourceKey: 'run-1', createdAt: 'x' },
        { operationId: 'b', characterId: 'c2', userId: 'u1', kind: 'REGION', amount: 30, qualified: true, afk: false, sourceKey: 'region-1', createdAt: 'x' },
        { operationId: 'c', characterId: 'c3', userId: 'u2', kind: 'ACTIVITY', amount: 50, qualified: true, afk: true, sourceKey: 'run-2', createdAt: 'x' },
        { operationId: 'd', characterId: 'c4', userId: 'u3', kind: 'MATERIAL', amount: 90, qualified: true, afk: false, sourceKey: 'item-1', createdAt: 'x' },
      ],
    };
    expect(contractProgress(contract)).toBe(50);
  });

  it('keeps project definitions frozen and advances only the current authored stage', () => {
    const project: GuildProjectInstanceState = {
      id: 'project-1',
      definitionKey: 'ritual-hall',
      definitionVersion: 1,
      snapshot: {
        title: 'Ritual Hall',
        stages: [
          { key: 'materials', target: 20, contributionKinds: ['MATERIAL'] },
          { key: 'craft', target: 10, contributionKinds: ['CRAFT'] },
        ],
        unlockKey: 'guild:ritual-hunts',
        rewardXp: 40,
      },
      stageIndex: 0,
      stageProgress: 0,
      status: 'ACTIVE',
      contributions: [
        { operationId: 'a', characterId: 'c1', userId: 'u1', kind: 'MATERIAL', amount: 12, qualified: true, afk: false, sourceKey: 'ore', createdAt: 'x' },
        { operationId: 'b', characterId: 'c2', userId: 'u2', kind: 'CRAFT', amount: 99, qualified: true, afk: false, sourceKey: 'craft', createdAt: 'x' },
      ],
    };
    expect(projectStageProgress(project)).toBe(12);
    expect(project.snapshot.unlockKey).toBe('guild:ritual-hunts');
  });

  it('requires real mentoring progress, rejects same-account pairs and enforces weekly cap', () => {
    const mentorship: MentorshipState = {
      id: 'mentorship-1',
      mentorCharacterId: 'mentor',
      mentorUserId: 'u1',
      learnerCharacterId: 'learner',
      learnerUserId: 'u2',
      activityKey: 'expedition:ashen-pilgrimage',
      startedAt: 'x',
      status: 'ACTIVE',
      qualifiedSteps: 1,
      afkSeconds: 10,
      rewardGranted: false,
    };
    expect(mentorshipCompletionAllowed(mentorship, 0)).toBe(true);
    expect(mentorshipCompletionAllowed({ ...mentorship, learnerUserId: 'u1' }, 0)).toBe(false);
    expect(mentorshipCompletionAllowed({ ...mentorship, qualifiedSteps: 0 }, 0)).toBe(false);
    expect(mentorshipCompletionAllowed(mentorship, 5)).toBe(false);
  });

  it('applies capped diminishing regional contribution for solo players and guild members', () => {
    expect(effectiveRegionContribution(0, 100)).toBe(100);
    expect(effectiveRegionContribution(250, 100)).toBe(50);
    expect(effectiveRegionContribution(700, 100)).toBe(25);
    expect(effectiveRegionContribution(1_000, 100)).toBe(0);
    const goal: RegionGoalState = {
      regionKey: 'ashen-march',
      phaseKey: 'warding',
      target: 5_000,
      totalEffectiveContribution: 0,
      contributionByCharacter: {},
      contributionByGuild: {},
      updatedAt: 'x',
    };
    const solo = applyRegionContribution(goal, 'solo', undefined, 100, 'y');
    const guild = applyRegionContribution(solo.goal, 'guild-member', 'guild-1', 100, 'z');
    expect(solo.effectiveAmount).toBe(100);
    expect(guild.goal.contributionByGuild['guild-1']).toBe(100);
  });


  it('protects bank withdrawals with locks, stock checks, daily limits and operation replay', () => {
    expect(() => assertBankWithdrawal({ available: 5, requested: 2, locked: false, dailyUsed: 7, dailyLimit: 10 })).not.toThrow();
    expect(() => assertBankWithdrawal({ available: 1, requested: 2, locked: false, dailyUsed: 0, dailyLimit: 10 })).toThrow('SOCIAL_BANK_ITEM_INVALID');
    expect(() => assertBankWithdrawal({ available: 5, requested: 1, locked: true, dailyUsed: 0, dailyLimit: 10 })).toThrow('SOCIAL_BANK_ITEM_INVALID');
    expect(() => assertBankWithdrawal({ available: 5, requested: 2, locked: false, dailyUsed: 9, dailyLimit: 10 })).toThrow('SOCIAL_BANK_DAILY_LIMIT');
    expect(assertOperationReplay(undefined, 'WITHDRAW', 'hash-a')).toBe('NEW');
    expect(assertOperationReplay({ kind: 'WITHDRAW', requestHash: 'hash-a' }, 'WITHDRAW', 'hash-a')).toBe('REPLAY');
    expect(() => assertOperationReplay({ kind: 'WITHDRAW', requestHash: 'hash-a' }, 'WITHDRAW', 'hash-b')).toThrow('SOCIAL_OPERATION_COLLISION');
  });

  it('derives guild levels only from audited contract or project experience', () => {
    expect(guildLevelForExperience(0)).toBe(1);
    expect(guildLevelForExperience(249)).toBe(1);
    expect(guildLevelForExperience(250)).toBe(2);
    expect(guildLevelForExperience(100_000)).toBe(20);
  });

  it('reports fill rate and reward concentration without winner-takes-all semantics', () => {
    expect(metricFillRate({
      listingsCreated: 4,
      listingsStarted: 3,
      applications: 0,
      acceptedApplications: 0,
      lobbyDropoffs: 1,
      activitiesCompleted: 0,
      repeatParties: 0,
      afkFlags: 0,
      disconnects: 0,
      mentoringCompleted: 0,
      mentoringAbuseFlags: 0,
      rewardByGuild: {},
    })).toBe(0.75);
    expect(rewardConcentration({ a: 50, b: 30, c: 20 })).toBe(0.5);
  });
});
