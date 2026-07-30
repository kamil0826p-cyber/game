import type { CharacterClass } from './game';
import type { SocketAck } from './socket';

export interface GroupMemberPayload {
  characterId: string;
  name: string;
  characterClass: CharacterClass;
  level: number;
  outfitKey: string;
  hp: number;
  maxHp: number;
  online: boolean;
  admin: boolean;
}

export interface GroupDetailsPayload {
  id: string;
  adminCharacterId: string;
  maxMembers: number;
  members: GroupMemberPayload[];
}

export interface GroupInvitePayload {
  inviteId: string;
  inviterCharacterId: string;
  inviterName: string;
  inviterLevel: number;
  inviterOutfitKey: string;
  inviterClass: CharacterClass;
  expiresAt: number;
}

export interface GroupSnapshot {
  group: GroupDetailsPayload | null;
  invites: GroupInvitePayload[];
}

declare module './socket' {
  interface ClientToServerEvents {
    'group:get': (
      payload: { requestId: string },
      acknowledgement: (response: SocketAck<GroupSnapshot>) => void,
    ) => void;
    'group:invite': (
      payload: { requestId: string; targetCharacterId: string },
      acknowledgement: (response: SocketAck<GroupSnapshot>) => void,
    ) => void;
    'group:respond': (
      payload: { requestId: string; inviteId: string; accept: boolean },
      acknowledgement: (response: SocketAck<GroupSnapshot>) => void,
    ) => void;
    'group:leave': (
      payload: { requestId: string },
      acknowledgement: (response: SocketAck<GroupSnapshot>) => void,
    ) => void;
    'group:kick': (
      payload: { requestId: string; targetCharacterId: string },
      acknowledgement: (response: SocketAck<GroupSnapshot>) => void,
    ) => void;
  }

  interface ServerToClientEvents {
    'group:updated': (payload: GroupSnapshot) => void;
  }
}
