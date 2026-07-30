import type { SocketAck } from './socket';

export type GuildRole = 'LEADER' | 'OFFICER' | 'MEMBER';

export interface GuildMemberPayload {
  characterId: string;
  name: string;
  level: number;
  role: GuildRole;
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
  role: GuildRole;
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

declare module './socket' {
  interface ClientToServerEvents {
    'guild:get': (payload: { requestId: string }, acknowledgement: (response: SocketAck<GuildSnapshot>) => void) => void;
    'guild:create': (payload: { requestId: string; name: string; tag: string; description: string }, acknowledgement: (response: SocketAck<GuildSnapshot>) => void) => void;
    'guild:invite': (payload: { requestId: string; characterName: string }, acknowledgement: (response: SocketAck<GuildSnapshot>) => void) => void;
    'guild:respond': (payload: { requestId: string; inviteId: string; accept: boolean }, acknowledgement: (response: SocketAck<GuildSnapshot>) => void) => void;
    'guild:updateDescription': (payload: { requestId: string; description: string }, acknowledgement: (response: SocketAck<GuildSnapshot>) => void) => void;
    'guild:setRole': (payload: { requestId: string; targetCharacterId: string; role: 'OFFICER' | 'MEMBER' }, acknowledgement: (response: SocketAck<GuildSnapshot>) => void) => void;
    'guild:kick': (payload: { requestId: string; targetCharacterId: string }, acknowledgement: (response: SocketAck<GuildSnapshot>) => void) => void;
    'guild:leave': (payload: { requestId: string }, acknowledgement: (response: SocketAck<GuildSnapshot>) => void) => void;
    'guild:transferLeadership': (payload: { requestId: string; targetCharacterId: string }, acknowledgement: (response: SocketAck<GuildSnapshot>) => void) => void;
    'guild:disband': (payload: { requestId: string }, acknowledgement: (response: SocketAck<GuildSnapshot>) => void) => void;
    'guild:chatSend': (payload: { requestId: string; text: string }, acknowledgement: (response: SocketAck<GuildChatMessagePayload>) => void) => void;
  }

  interface ServerToClientEvents {
    'guild:updated': (payload: GuildSnapshot) => void;
    'guild:chatMessage': (payload: GuildChatMessagePayload) => void;
  }
}
