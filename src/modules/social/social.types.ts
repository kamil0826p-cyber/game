export const SOCIAL_STATE_VERSION = 1 as const;
export const SOCIAL_MAX_PARTY_SIZE = 10;
export const SOCIAL_RECENT_PLAYERS_LIMIT = 50;
export const SOCIAL_MENTOR_WEEKLY_CAP = 5;

export type SocialActivityType =
  | 'EXPEDITION'
  | 'WORLD_ENCOUNTER'
  | 'GROUP_QUEST'
  | 'PVP'
  | 'GUILD_CONTRACT';
export type FinderAcceptancePolicy = 'MANUAL' | 'AUTO';
export type FinderListingStatus = 'OPEN' | 'LOBBY' | 'FROZEN' | 'STARTED' | 'COMPLETED' | 'CANCELLED';
export type BuildFunction =
  | 'PROTECTION'
  | 'INTERRUPT'
  | 'CLEANSE'
  | 'CONTROL'
  | 'BURST'
  | 'SCOUT'
  | 'SUSTAIN'
  | 'SUPPORT';
export type Formation = 'FRONT' | 'BACK';
export type SocialRiskProfile = 'LOW' | 'STANDARD' | 'HIGH' | 'RITUAL';
export type GuildSocialPermission =
  | 'INVITE'
  | 'KICK'
  | 'ROLE'
  | 'DESCRIPTION'
  | 'DISBAND'
  | 'BANK_DEPOSIT'
  | 'BANK_WITHDRAW'
  | 'BANK_AUDIT'
  | 'CONTRACT_MANAGE'
  | 'PROJECT_MANAGE'
  | 'ANNOUNCEMENT_MANAGE'
  | 'EVENT_MANAGE';

export interface FinderRequirementSnapshot {
  minimumLevel?: number;
  maximumLevel?: number;
  requiredItemKeys?: string[];
  requiredFlagKeys?: string[];
}

export interface FinderMemberState {
  characterId: string;
  userId: string;
  name: string;
  level: number;
  characterClass: 'MAGE' | 'WARRIOR' | 'ARCHER';
  functions: BuildFunction[];
  formation: Formation;
  loadoutReady: boolean;
  requirementsMet: boolean;
  riskAccepted: boolean;
  consumableSummary: string[];
  reconnectStatus: 'ONLINE' | 'RECONNECTING' | 'OFFLINE';
  readyAt?: string;
}

export interface FinderApplicantState {
  characterId: string;
  userId: string;
  name: string;
  level: number;
  characterClass: 'MAGE' | 'WARRIOR' | 'ARCHER';
  functions: BuildFunction[];
  appliedAt: string;
}

export interface FinderListingState {
  id: string;
  ownerCharacterId: string;
  realmId: string;
  activityType: SocialActivityType;
  activityKey: string;
  title: string;
  minimumSize: number;
  maximumSize: number;
  levelHint: { minimum?: number; maximum?: number };
  requestedFunctions: BuildFunction[];
  language: string;
  expectedMinutes: number;
  riskProfile: SocialRiskProfile;
  requirements: FinderRequirementSnapshot;
  acceptancePolicy: FinderAcceptancePolicy;
  decisionPolicy: 'LEADER' | 'VOTE';
  status: FinderListingStatus;
  members: FinderMemberState[];
  applicants: FinderApplicantState[];
  frozenCharacterIds: string[];
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface RecentPlayerEntry {
  characterId: string;
  name: string;
  activityKey: string;
  outcome: 'COMPLETED' | 'FAILED' | 'ABANDONED';
  completedAt: string;
  finished: boolean;
  disconnected: boolean;
}

export interface MentorProfileState {
  characterId: string;
  userId: string;
  language: string;
  activityKeys: string[];
  active: boolean;
  reputation: number;
  weeklyCompleted: number;
  weekKey: string;
  updatedAt: string;
}

export interface MentorshipState {
  id: string;
  mentorCharacterId: string;
  mentorUserId: string;
  learnerCharacterId: string;
  learnerUserId: string;
  activityKey: string;
  startedAt: string;
  completedAt?: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'FLAGGED';
  qualifiedSteps: number;
  afkSeconds: number;
  rewardGranted: boolean;
}

export interface QualifiedContribution {
  operationId: string;
  characterId: string;
  userId: string;
  kind: 'ACTIVITY' | 'MATERIAL' | 'CRAFT' | 'REGION' | 'CHOICE' | 'PVP_OBJECTIVE';
  amount: number;
  qualified: boolean;
  afk: boolean;
  sourceKey: string;
  createdAt: string;
}

export interface GuildContractInstanceState {
  id: string;
  definitionKey: string;
  definitionVersion: number;
  snapshot: {
    title: string;
    target: number;
    rewardXp: number;
    rewardUnlockKey?: string;
    contributionKinds: QualifiedContribution['kind'][];
    perCharacterCap: number;
    perAccountCap: number;
  };
  status: 'ACTIVE' | 'COMPLETED' | 'SETTLED' | 'EXPIRED';
  startsAt: string;
  endsAt: string;
  contributions: QualifiedContribution[];
  settlementOperationId?: string;
  settledAt?: string;
}

export interface GuildProjectInstanceState {
  id: string;
  definitionKey: string;
  definitionVersion: number;
  snapshot: {
    title: string;
    stages: Array<{
      key: string;
      target: number;
      contributionKinds: QualifiedContribution['kind'][];
    }>;
    unlockKey: string;
    rewardXp: number;
  };
  stageIndex: number;
  stageProgress: number;
  status: 'ACTIVE' | 'COMPLETED' | 'SETTLED';
  contributions: QualifiedContribution[];
  settlementOperationId?: string;
  settledAt?: string;
}

export interface GuildAnnouncementState {
  id: string;
  title: string;
  body: string;
  authorCharacterId: string;
  createdAt: string;
  pinned: boolean;
}

export interface GuildEventState {
  id: string;
  title: string;
  startsAt: string;
  durationMinutes: number;
  activityKey?: string;
  authorCharacterId: string;
  createdAt: string;
  rsvp: Record<string, 'YES' | 'MAYBE' | 'NO'>;
}

export interface RegionGoalState {
  regionKey: string;
  phaseKey: string;
  target: number;
  totalEffectiveContribution: number;
  contributionByCharacter: Record<string, number>;
  contributionByGuild: Record<string, number>;
  updatedAt: string;
}

export interface SocialMetricsState {
  listingsCreated: number;
  listingsStarted: number;
  applications: number;
  acceptedApplications: number;
  lobbyDropoffs: number;
  activitiesCompleted: number;
  repeatParties: number;
  afkFlags: number;
  disconnects: number;
  mentoringCompleted: number;
  mentoringAbuseFlags: number;
  rewardByGuild: Record<string, number>;
}

export interface ProcessedSocialOperation {
  kind: string;
  requestHash: string;
  result: unknown;
  completedAt: string;
}

export interface SocialRealmState {
  version: typeof SOCIAL_STATE_VERSION;
  listings: Record<string, FinderListingState>;
  recentByCharacter: Record<string, RecentPlayerEntry[]>;
  contactsByCharacter: Record<string, string[]>;
  mentorProfiles: Record<string, MentorProfileState>;
  mentorships: Record<string, MentorshipState>;
  regionGoals: Record<string, RegionGoalState>;
  operations: Record<string, ProcessedSocialOperation>;
  metrics: SocialMetricsState;
}

export interface GuildSocialState {
  version: typeof SOCIAL_STATE_VERSION;
  contracts: Record<string, GuildContractInstanceState>;
  projects: Record<string, GuildProjectInstanceState>;
  unlockKeys: string[];
  announcements: GuildAnnouncementState[];
  events: GuildEventState[];
  xpAudit: Array<{
    operationId: string;
    sourceType: 'CONTRACT' | 'PROJECT';
    sourceId: string;
    amount: number;
    createdAt: string;
  }>;
  contributionByCharacter: Record<string, number>;
  rewardByCharacter: Record<string, number>;
  operations: Record<string, ProcessedSocialOperation>;
}

export interface SocialDashboardView {
  listings: FinderListingState[];
  ownListing?: FinderListingState;
  recentPlayers: RecentPlayerEntry[];
  contacts: string[];
  blockedCharacterIds: string[];
  mentorProfile?: MentorProfileState;
  activeMentorships: MentorshipState[];
  regionGoals: RegionGoalState[];
  guild?: {
    guildId: string;
    permissions: GuildSocialPermission[];
    contracts: GuildContractInstanceState[];
    projects: GuildProjectInstanceState[];
    unlockKeys: string[];
    announcements: GuildAnnouncementState[];
    events: GuildEventState[];
    bank: GuildBankItemView[];
    bankAudit: GuildBankAuditView[];
    level: number;
    experience: number;
  };
  metrics: {
    fillRate: number;
    lobbyDropoffRate: number;
    mentoringCompletionRate: number;
    rewardConcentration: number;
  };
}

export interface GuildBankItemView {
  id: string;
  tabKey: string;
  itemDefinitionKey: string;
  itemName: string;
  quantity: number;
  lockedProjectKey?: string;
  revision: number;
}

export interface GuildBankAuditView {
  id: string;
  operationId: string;
  actorCharacterId: string;
  action: string;
  itemDefinitionKey?: string;
  quantity: number;
  createdAt: string;
}
