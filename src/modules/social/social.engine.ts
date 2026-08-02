import {
  SOCIAL_MAX_PARTY_SIZE,
  SOCIAL_MENTOR_WEEKLY_CAP,
  SOCIAL_RECENT_PLAYERS_LIMIT,
  type FinderListingState,
  type FinderMemberState,
  type GuildContractInstanceState,
  type GuildProjectInstanceState,
  type MentorshipState,
  type QualifiedContribution,
  type RecentPlayerEntry,
  type RegionGoalState,
  type SocialMetricsState,
} from './social.types.js';

export function assertFinderPartySize(minimumSize: number, maximumSize: number): void {
  if (
    !Number.isInteger(minimumSize) ||
    !Number.isInteger(maximumSize) ||
    minimumSize < 1 ||
    maximumSize > SOCIAL_MAX_PARTY_SIZE ||
    minimumSize > maximumSize
  ) {
    throw new Error('SOCIAL_PARTY_SIZE_INVALID');
  }
}

export function assertStableActivityKey(value: string): void {
  if (!/^[a-z0-9][a-z0-9:_-]{1,95}$/.test(value)) {
    throw new Error('SOCIAL_ACTIVITY_KEY_INVALID');
  }
}

export function finderMissingRequirements(listing: FinderListingState): string[] {
  const missing: string[] = [];
  if (listing.members.length < listing.minimumSize) missing.push('PARTY_SIZE');
  if (listing.members.length > listing.maximumSize) missing.push('PARTY_OVERFLOW');
  if (listing.members.some((member) => !member.requirementsMet)) missing.push('ENTRY_REQUIREMENTS');
  if (listing.members.some((member) => !member.loadoutReady)) missing.push('LOADOUT');
  if (listing.members.some((member) => !member.riskAccepted)) missing.push('RISK_ACCEPTANCE');
  if (listing.members.some((member) => member.reconnectStatus !== 'ONLINE')) missing.push('CONNECTION');
  return missing;
}

export function freezeFinderListing(listing: FinderListingState, now: string): FinderListingState {
  if (listing.status !== 'LOBBY' && listing.status !== 'OPEN') {
    throw new Error('SOCIAL_LISTING_NOT_STARTABLE');
  }
  const missing = finderMissingRequirements(listing);
  if (missing.length > 0) throw new Error(`SOCIAL_READY_CHECK_FAILED:${missing.join(',')}`);
  const characterIds = listing.members.map((member) => member.characterId);
  if (new Set(characterIds).size !== characterIds.length) throw new Error('SOCIAL_DUPLICATE_MEMBER');
  return {
    ...listing,
    status: 'FROZEN',
    frozenCharacterIds: [...characterIds],
    applicants: [],
    revision: listing.revision + 1,
    updatedAt: now,
  };
}

export function updateFinderReadiness(
  listing: FinderListingState,
  characterId: string,
  patch: Pick<
    FinderMemberState,
    'functions' | 'formation' | 'loadoutReady' | 'requirementsMet' | 'riskAccepted' | 'consumableSummary'
  >,
  now: string,
): FinderListingState {
  if (listing.status === 'FROZEN' || listing.status === 'STARTED' || listing.status === 'COMPLETED' || listing.status === 'CANCELLED') {
    throw new Error('SOCIAL_ROSTER_FROZEN');
  }
  let found = false;
  const members = listing.members.map((member) => {
    if (member.characterId !== characterId) return member;
    found = true;
    return {
      ...member,
      ...patch,
      functions: [...new Set(patch.functions)],
      consumableSummary: [...new Set(patch.consumableSummary)].slice(0, 8),
      readyAt:
        patch.loadoutReady && patch.requirementsMet && patch.riskAccepted ? now : undefined,
    };
  });
  if (!found) throw new Error('SOCIAL_MEMBER_NOT_FOUND');
  return { ...listing, members, status: 'LOBBY', revision: listing.revision + 1, updatedAt: now };
}

export function appendRecentPlayer(
  entries: readonly RecentPlayerEntry[],
  entry: RecentPlayerEntry,
): RecentPlayerEntry[] {
  return [
    entry,
    ...entries.filter(
      (existing) =>
        existing.characterId !== entry.characterId ||
        existing.activityKey !== entry.activityKey ||
        existing.completedAt !== entry.completedAt,
    ),
  ].slice(0, SOCIAL_RECENT_PLAYERS_LIMIT);
}

export function qualifiedContributionAmount(
  contribution: QualifiedContribution,
  acceptedKinds: readonly QualifiedContribution['kind'][],
): number {
  if (
    !contribution.qualified ||
    contribution.afk ||
    contribution.amount <= 0 ||
    !acceptedKinds.includes(contribution.kind)
  ) {
    return 0;
  }
  return Math.trunc(contribution.amount);
}

export function contractProgress(contract: GuildContractInstanceState): number {
  const byCharacter = new Map<string, number>();
  const byAccount = new Map<string, number>();
  let total = 0;
  for (const contribution of contract.contributions) {
    const amount = qualifiedContributionAmount(
      contribution,
      contract.snapshot.contributionKinds,
    );
    if (amount <= 0) continue;
    const characterRoom = Math.max(
      0,
      contract.snapshot.perCharacterCap - (byCharacter.get(contribution.characterId) ?? 0),
    );
    const accountRoom = Math.max(
      0,
      contract.snapshot.perAccountCap - (byAccount.get(contribution.userId) ?? 0),
    );
    const accepted = Math.min(amount, characterRoom, accountRoom);
    byCharacter.set(
      contribution.characterId,
      (byCharacter.get(contribution.characterId) ?? 0) + accepted,
    );
    byAccount.set(contribution.userId, (byAccount.get(contribution.userId) ?? 0) + accepted);
    total += accepted;
  }
  return Math.min(contract.snapshot.target, total);
}

export function projectStageProgress(project: GuildProjectInstanceState): number {
  const stage = project.snapshot.stages[project.stageIndex];
  if (!stage) return 0;
  return Math.min(
    stage.target,
    project.contributions.reduce(
      (sum, contribution) =>
        sum + qualifiedContributionAmount(contribution, stage.contributionKinds),
      0,
    ),
  );
}

export function mentorshipCompletionAllowed(
  mentorship: MentorshipState,
  weeklyCompleted: number,
): boolean {
  return (
    mentorship.status === 'ACTIVE' &&
    mentorship.mentorUserId !== mentorship.learnerUserId &&
    mentorship.qualifiedSteps > 0 &&
    mentorship.afkSeconds < 120 &&
    weeklyCompleted < SOCIAL_MENTOR_WEEKLY_CAP
  );
}

export function effectiveRegionContribution(previousPersonal: number, rawAmount: number): number {
  const amount = Math.max(0, Math.trunc(rawAmount));
  const personal = Math.max(0, Math.trunc(previousPersonal));
  if (personal >= 1_000) return 0;
  const remaining = 1_000 - personal;
  const diminishingFactor = personal < 200 ? 1 : personal < 500 ? 0.5 : 0.25;
  return Math.min(remaining, Math.max(0, Math.floor(amount * diminishingFactor)));
}

export function applyRegionContribution(
  goal: RegionGoalState,
  characterId: string,
  guildId: string | undefined,
  rawAmount: number,
  now: string,
): { goal: RegionGoalState; effectiveAmount: number } {
  const previous = goal.contributionByCharacter[characterId] ?? 0;
  const effectiveAmount = effectiveRegionContribution(previous, rawAmount);
  const next: RegionGoalState = structuredClone(goal);
  next.contributionByCharacter[characterId] = previous + effectiveAmount;
  if (guildId) {
    next.contributionByGuild[guildId] =
      (next.contributionByGuild[guildId] ?? 0) + effectiveAmount;
  }
  next.totalEffectiveContribution = Math.min(
    goal.target,
    goal.totalEffectiveContribution + effectiveAmount,
  );
  next.updatedAt = now;
  return { goal: next, effectiveAmount };
}

export function metricFillRate(metrics: SocialMetricsState): number {
  return metrics.listingsCreated === 0 ? 0 : metrics.listingsStarted / metrics.listingsCreated;
}

export function metricLobbyDropoffRate(metrics: SocialMetricsState): number {
  const lobbies = metrics.listingsStarted + metrics.lobbyDropoffs;
  return lobbies === 0 ? 0 : metrics.lobbyDropoffs / lobbies;
}

export function metricMentoringCompletionRate(metrics: SocialMetricsState): number {
  const attempts = metrics.mentoringCompleted + metrics.mentoringAbuseFlags;
  return attempts === 0 ? 0 : metrics.mentoringCompleted / attempts;
}

export function rewardConcentration(rewardByGuild: Record<string, number>): number {
  const values = Object.values(rewardByGuild).filter((value) => value > 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total === 0) return 0;
  return Math.max(...values) / total;
}

export function assertBankWithdrawal(input: {
  available: number;
  requested: number;
  locked: boolean;
  dailyUsed: number;
  dailyLimit: number;
}): void {
  if (
    !Number.isInteger(input.requested) ||
    input.requested <= 0 ||
    input.available < input.requested ||
    input.locked
  ) {
    throw new Error('SOCIAL_BANK_ITEM_INVALID');
  }
  if (input.dailyUsed + input.requested > input.dailyLimit) {
    throw new Error('SOCIAL_BANK_DAILY_LIMIT');
  }
}

export function assertOperationReplay(
  existing: { kind: string; requestHash: string } | undefined,
  kind: string,
  requestHash: string,
): 'NEW' | 'REPLAY' {
  if (!existing) return 'NEW';
  if (existing.kind !== kind || existing.requestHash !== requestHash) {
    throw new Error('SOCIAL_OPERATION_COLLISION');
  }
  return 'REPLAY';
}

export function guildLevelForExperience(experience: number): number {
  return Math.min(20, 1 + Math.floor(Math.max(0, experience) / 250));
}
