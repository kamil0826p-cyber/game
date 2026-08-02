import {
  SOCIAL_STATE_VERSION,
  type GuildSocialState,
  type SocialRealmState,
} from './social.types.js';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const emptySocialMetrics = (): SocialRealmState['metrics'] => ({
  listingsCreated: 0,
  listingsStarted: 0,
  applications: 0,
  acceptedApplications: 0,
  lobbyDropoffs: 0,
  activitiesCompleted: 0,
  repeatParties: 0,
  afkFlags: 0,
  disconnects: 0,
  mentoringCompleted: 0,
  mentoringAbuseFlags: 0,
  rewardByGuild: {},
});

export const emptySocialRealmState = (): SocialRealmState => ({
  version: SOCIAL_STATE_VERSION,
  listings: {},
  recentByCharacter: {},
  contactsByCharacter: {},
  mentorProfiles: {},
  mentorships: {},
  regionGoals: {},
  operations: {},
  metrics: emptySocialMetrics(),
});

export const emptyGuildSocialState = (): GuildSocialState => ({
  version: SOCIAL_STATE_VERSION,
  contracts: {},
  projects: {},
  unlockKeys: [],
  announcements: [],
  events: [],
  xpAudit: [],
  contributionByCharacter: {},
  rewardByCharacter: {},
  operations: {},
});

export function parseSocialRealmState(value: unknown): SocialRealmState {
  if (!record(value) || value.version !== SOCIAL_STATE_VERSION) return emptySocialRealmState();
  const parsed = structuredClone(value) as unknown as SocialRealmState;
  parsed.listings ??= {};
  parsed.recentByCharacter ??= {};
  parsed.contactsByCharacter ??= {};
  parsed.mentorProfiles ??= {};
  parsed.mentorships ??= {};
  parsed.regionGoals ??= {};
  parsed.operations ??= {};
  parsed.metrics = { ...emptySocialMetrics(), ...(parsed.metrics ?? {}) };
  parsed.metrics.rewardByGuild ??= {};
  return parsed;
}

export function parseGuildSocialState(value: unknown): GuildSocialState {
  if (!record(value) || value.version !== SOCIAL_STATE_VERSION) return emptyGuildSocialState();
  const parsed = structuredClone(value) as unknown as GuildSocialState;
  parsed.contracts ??= {};
  parsed.projects ??= {};
  parsed.unlockKeys ??= [];
  parsed.announcements ??= [];
  parsed.events ??= [];
  parsed.xpAudit ??= [];
  parsed.contributionByCharacter ??= {};
  parsed.rewardByCharacter ??= {};
  parsed.operations ??= {};
  return parsed;
}
