import type { SocketAck } from './socket';

export type BuildFunction =
  | 'PROTECTION' | 'INTERRUPT' | 'CLEANSE' | 'CONTROL'
  | 'BURST' | 'SCOUT' | 'SUSTAIN' | 'SUPPORT';
export type GuildSocialPermission =
  | 'INVITE' | 'KICK' | 'ROLE' | 'DESCRIPTION' | 'DISBAND'
  | 'BANK_DEPOSIT' | 'BANK_WITHDRAW' | 'BANK_AUDIT'
  | 'CONTRACT_MANAGE' | 'PROJECT_MANAGE' | 'ANNOUNCEMENT_MANAGE' | 'EVENT_MANAGE';

export interface FinderMember {
  characterId: string;
  name: string;
  level: number;
  characterClass: 'MAGE' | 'WARRIOR' | 'ARCHER';
  functions: BuildFunction[];
  formation: 'FRONT' | 'BACK';
  loadoutReady: boolean;
  requirementsMet: boolean;
  riskAccepted: boolean;
  reconnectStatus: 'ONLINE' | 'RECONNECTING' | 'OFFLINE';
}
export interface FinderApplicant {
  characterId: string;
  name: string;
  level: number;
  characterClass: 'MAGE' | 'WARRIOR' | 'ARCHER';
  functions: BuildFunction[];
}
export interface FinderListing {
  id: string;
  ownerCharacterId: string;
  activityType: 'EXPEDITION' | 'WORLD_ENCOUNTER' | 'GROUP_QUEST' | 'PVP' | 'GUILD_CONTRACT';
  activityKey: string;
  title: string;
  minimumSize: number;
  maximumSize: number;
  requestedFunctions: BuildFunction[];
  language: string;
  expectedMinutes: number;
  riskProfile: 'LOW' | 'STANDARD' | 'HIGH' | 'RITUAL';
  acceptancePolicy: 'MANUAL' | 'AUTO';
  status: 'OPEN' | 'LOBBY' | 'FROZEN' | 'STARTED' | 'COMPLETED' | 'CANCELLED';
  members: FinderMember[];
  applicants: FinderApplicant[];
  frozenCharacterIds: string[];
  revision: number;
}
export interface RecentPlayer {
  characterId: string;
  name: string;
  activityKey: string;
  outcome: 'COMPLETED' | 'FAILED' | 'ABANDONED';
  completedAt: string;
  finished: boolean;
  disconnected: boolean;
}
export interface MentorProfile {
  characterId: string;
  language: string;
  activityKeys: string[];
  active: boolean;
  reputation: number;
  weeklyCompleted: number;
}
export interface Mentorship {
  id: string;
  mentorCharacterId: string;
  learnerCharacterId: string;
  activityKey: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'FLAGGED';
  qualifiedSteps: number;
  afkSeconds: number;
}
export interface GuildContract {
  id: string;
  definitionKey: string;
  definitionVersion: number;
  snapshot: { title: string; target: number; rewardXp: number; rewardUnlockKey?: string };
  status: 'ACTIVE' | 'COMPLETED' | 'SETTLED' | 'EXPIRED';
  contributions: Array<{ amount: number; qualified: boolean; afk: boolean }>;
}
export interface GuildProject {
  id: string;
  definitionKey: string;
  definitionVersion: number;
  snapshot: { title: string; stages: Array<{ key: string; target: number }>; unlockKey: string; rewardXp: number };
  stageIndex: number;
  stageProgress: number;
  status: 'ACTIVE' | 'COMPLETED' | 'SETTLED';
}
export interface GuildBankItem {
  id: string;
  tabKey: string;
  itemDefinitionKey: string;
  itemName: string;
  quantity: number;
  lockedProjectKey?: string;
  revision: number;
}
export interface GuildBankAudit {
  id: string;
  actorCharacterId: string;
  action: string;
  itemDefinitionKey?: string;
  quantity: number;
  createdAt: string;
}
export interface GuildAnnouncement { id: string; title: string; body: string; pinned: boolean; createdAt: string; }
export interface GuildEvent { id: string; title: string; startsAt: string; durationMinutes: number; activityKey?: string; rsvp: Record<string, 'YES' | 'MAYBE' | 'NO'>; }
export interface RegionGoal { regionKey: string; phaseKey: string; target: number; totalEffectiveContribution: number; }
export interface SocialDashboard {
  listings: FinderListing[];
  ownListing?: FinderListing;
  recentPlayers: RecentPlayer[];
  contacts: string[];
  blockedCharacterIds: string[];
  mentorProfile?: MentorProfile;
  activeMentorships: Mentorship[];
  regionGoals: RegionGoal[];
  guild?: {
    guildId: string;
    permissions: GuildSocialPermission[];
    contracts: GuildContract[];
    projects: GuildProject[];
    unlockKeys: string[];
    announcements: GuildAnnouncement[];
    events: GuildEvent[];
    bank: GuildBankItem[];
    bankAudit: GuildBankAudit[];
    level: number;
    experience: number;
  };
  metrics: { fillRate: number; lobbyDropoffRate: number; mentoringCompletionRate: number; rewardConcentration: number };
}

export interface FinderCreateInput {
  activityType: FinderListing['activityType'];
  activityKey: string;
  title: string;
  minimumSize: number;
  maximumSize: number;
  levelHint: { minimum?: number; maximum?: number };
  requestedFunctions: BuildFunction[];
  language: string;
  expectedMinutes: number;
  riskProfile: FinderListing['riskProfile'];
  requirements: { minimumLevel?: number; maximumLevel?: number; requiredItemKeys?: string[]; requiredFlagKeys?: string[] };
  acceptancePolicy: 'MANUAL' | 'AUTO';
  decisionPolicy: 'LEADER' | 'VOTE';
}

declare module './socket' {
  interface ClientToServerEvents {
    'social:get': (payload: { requestId: string }, acknowledgement?: (response: SocketAck<SocialDashboard>) => void) => void;
    'social:finderCreate': (payload: FinderCreateInput & { operationId: string }, acknowledgement?: (response: SocketAck<SocialDashboard>) => void) => void;
    'social:finderApply': (payload: { operationId: string; listingId: string; functions: BuildFunction[] }, acknowledgement?: (response: SocketAck<SocialDashboard>) => void) => void;
    'social:finderRespond': (payload: { operationId: string; listingId: string; targetCharacterId: string; accept: boolean }, acknowledgement?: (response: SocketAck<SocialDashboard>) => void) => void;
    'social:finderReady': (payload: { operationId: string; listingId: string; functions: BuildFunction[]; formation: 'FRONT' | 'BACK'; loadoutReady: boolean; riskAccepted: boolean; consumableSummary: string[] }, acknowledgement?: (response: SocketAck<SocialDashboard>) => void) => void;
    'social:finderStart': (payload: { operationId: string; listingId: string }, acknowledgement?: (response: SocketAck<SocialDashboard>) => void) => void;
    'social:finderCancel': (payload: { operationId: string; listingId: string }, acknowledgement?: (response: SocketAck<SocialDashboard>) => void) => void;
    'social:contactAdd': (payload: { operationId: string; targetCharacterId: string }, acknowledgement?: (response: SocketAck<SocialDashboard>) => void) => void;
    'social:blockSet': (payload: { operationId: string; targetCharacterId: string; blocked: boolean }, acknowledgement?: (response: SocketAck<SocialDashboard>) => void) => void;
    'social:mentorProfile': (payload: { operationId: string; active: boolean; language: string; activityKeys: string[] }, acknowledgement?: (response: SocketAck<SocialDashboard>) => void) => void;
    'social:contractCreate': (payload: { operationId: string; definitionKey: string; definitionVersion: number }, acknowledgement?: (response: SocketAck<SocialDashboard>) => void) => void;
    'social:contractSettle': (payload: { operationId: string; instanceId: string }, acknowledgement?: (response: SocketAck<SocialDashboard>) => void) => void;
    'social:projectCreate': (payload: { operationId: string; definitionKey: string; definitionVersion: number }, acknowledgement?: (response: SocketAck<SocialDashboard>) => void) => void;
    'social:projectSettle': (payload: { operationId: string; instanceId: string }, acknowledgement?: (response: SocketAck<SocialDashboard>) => void) => void;
    'social:bankWithdraw': (payload: { operationId: string; bankItemId: string; quantity: number }, acknowledgement?: (response: SocketAck<SocialDashboard>) => void) => void;
    'social:eventRsvp': (payload: { operationId: string; eventId: string; response: 'YES' | 'MAYBE' | 'NO' }, acknowledgement?: (response: SocketAck<SocialDashboard>) => void) => void;
  }
  interface ServerToClientEvents {
    'social:updated': (payload: SocialDashboard) => void;
  }
}

