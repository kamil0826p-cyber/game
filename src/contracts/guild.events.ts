import type { SocketAck } from './socket.events.js';
import type {
  GuildBuyExperienceUpgradePayload,
  GuildChatPayload,
  GuildCreatePayload,
  GuildDepositPayload,
  GuildDisbandPayload,
  GuildGetPayload,
  GuildInviteCommandPayload,
  GuildKickPayload,
  GuildLeavePayload,
  GuildRespondPayload,
  GuildSetRolePayload,
  GuildTransferLeadershipPayload,
  GuildUpdateDescriptionPayload,
  GuildWithdrawPayload,
} from './socket.schemas.js';

export type GuildRolePayload = 'LEADER' | 'OFFICER' | 'MEMBER';
export type GuildTreasuryTransactionTypePayload =
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'UPGRADE_PURCHASE';

export interface GuildMemberPayload {
  characterId: string;
  name: string;
  level: number;
  role: GuildRolePayload;
  online: boolean;
  joinedAt: number;
  contributedSilver: number;
  mobKills: number;
  bonusExperienceEarned: number;
  lastContributionAt: number | null;
}

export interface GuildTreasuryTransactionPayload {
  id: string;
  type: GuildTreasuryTransactionTypePayload;
  amount: number;
  balanceAfter: number;
  actorCharacterId: string;
  actorName: string;
  upgradeLevel: number | null;
  createdAt: number;
}

export interface GuildTreasuryPayload {
  silver: number;
  experienceUpgradeLevel: number;
  experienceBonusPercent: number;
  maximumUpgradeLevel: number;
  nextUpgradeCost: number | null;
  totalSilverDeposited: number;
  totalSilverWithdrawn: number;
  totalSilverSpentOnUpgrades: number;
  recentTransactions: GuildTreasuryTransactionPayload[];
}

export interface GuildStatisticsPayload {
  memberCount: number;
  onlineMemberCount: number;
  averageMemberLevel: number;
  totalMemberLevels: number;
  mobKills: number;
  bonusExperienceGranted: number;
}

export interface GuildDetailsPayload {
  id: string;
  name: string;
  tag: string;
  description: string;
  level: number;
  experience: number;
  role: GuildRolePayload;
  createdAt: number;
  members: GuildMemberPayload[];
  treasury: GuildTreasuryPayload;
  statistics: GuildStatisticsPayload;
}

export interface GuildInvitePayload {
  inviteId: string;
  guildId: string;
  guildName: string;
  guildTag: string;
  inviterName: string;
  expiresAt: number;
}

export interface GuildSnapshot {
  guild: GuildDetailsPayload | null;
  invites: GuildInvitePayload[];
  characterSilver: number;
}

export interface GuildChatMessagePayload {
  id: string;
  characterId: string;
  author: string;
  text: string;
  guildId: string;
  sentAt: number;
}

declare module './socket.events.js' {
  interface ClientToServerEvents {
    'guild:get': (payload: GuildGetPayload, acknowledgement?: (response: SocketAck<GuildSnapshot>) => void) => void;
    'guild:create': (payload: GuildCreatePayload, acknowledgement?: (response: SocketAck<GuildSnapshot>) => void) => void;
    'guild:invite': (payload: GuildInviteCommandPayload, acknowledgement?: (response: SocketAck<GuildSnapshot>) => void) => void;
    'guild:respond': (payload: GuildRespondPayload, acknowledgement?: (response: SocketAck<GuildSnapshot>) => void) => void;
    'guild:updateDescription': (payload: GuildUpdateDescriptionPayload, acknowledgement?: (response: SocketAck<GuildSnapshot>) => void) => void;
    'guild:setRole': (payload: GuildSetRolePayload, acknowledgement?: (response: SocketAck<GuildSnapshot>) => void) => void;
    'guild:kick': (payload: GuildKickPayload, acknowledgement?: (response: SocketAck<GuildSnapshot>) => void) => void;
    'guild:leave': (payload: GuildLeavePayload, acknowledgement?: (response: SocketAck<GuildSnapshot>) => void) => void;
    'guild:transferLeadership': (payload: GuildTransferLeadershipPayload, acknowledgement?: (response: SocketAck<GuildSnapshot>) => void) => void;
    'guild:disband': (payload: GuildDisbandPayload, acknowledgement?: (response: SocketAck<GuildSnapshot>) => void) => void;
    'guild:depositSilver': (payload: GuildDepositPayload, acknowledgement?: (response: SocketAck<GuildSnapshot>) => void) => void;
    'guild:withdrawSilver': (payload: GuildWithdrawPayload, acknowledgement?: (response: SocketAck<GuildSnapshot>) => void) => void;
    'guild:buyExperienceUpgrade': (payload: GuildBuyExperienceUpgradePayload, acknowledgement?: (response: SocketAck<GuildSnapshot>) => void) => void;
    'guild:chatSend': (payload: GuildChatPayload, acknowledgement?: (response: SocketAck<GuildChatMessagePayload>) => void) => void;
  }

  interface ServerToClientEvents {
    'guild:updated': (payload: GuildSnapshot) => void;
    'guild:chatMessage': (payload: GuildChatMessagePayload) => void;
  }
}
