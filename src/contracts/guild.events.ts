import type { SocketAck } from './socket.events.js';
import type {
  GuildChatPayload,
  GuildCreatePayload,
  GuildDisbandPayload,
  GuildGetPayload,
  GuildInviteCommandPayload,
  GuildKickPayload,
  GuildLeavePayload,
  GuildRespondPayload,
  GuildSetRolePayload,
  GuildTransferLeadershipPayload,
  GuildUpdateDescriptionPayload,
} from './socket.schemas.js';

export type GuildRolePayload = 'LEADER' | 'OFFICER' | 'MEMBER';

export interface GuildMemberPayload {
  characterId: string;
  name: string;
  level: number;
  role: GuildRolePayload;
  online: boolean;
  joinedAt: number;
}

export interface GuildDetailsPayload {
  id: string;
  name: string;
  tag: string;
  description: string;
  level: number;
  experience: number;
  role: GuildRolePayload;
  members: GuildMemberPayload[];
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
    'guild:chatSend': (payload: GuildChatPayload, acknowledgement?: (response: SocketAck<GuildChatMessagePayload>) => void) => void;
  }

  interface ServerToClientEvents {
    'guild:updated': (payload: GuildSnapshot) => void;
    'guild:chatMessage': (payload: GuildChatMessagePayload) => void;
  }
}
