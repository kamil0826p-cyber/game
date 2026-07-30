import type { CharacterClass } from '../common/domain/game.types.js';
import type { SocketAck } from './socket.events.js';
import type {
  GroupGetPayload,
  GroupInviteCommandPayload,
  GroupLeavePayload,
  GroupRespondPayload,
} from './group.schemas.js';

export interface GroupMemberPayload {
  characterId: string;
  name: string;
  characterClass: CharacterClass;
  level: number;
  outfitKey: string;
  hp: number;
  maxHp: number;
  online: boolean;
  leader: boolean;
}

export interface GroupDetailsPayload {
  id: string;
  leaderCharacterId: string;
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

declare module './socket.events.js' {
  interface ClientToServerEvents {
    'group:get': (
      payload: GroupGetPayload,
      acknowledgement?: (response: SocketAck<GroupSnapshot>) => void,
    ) => void;
    'group:invite': (
      payload: GroupInviteCommandPayload,
      acknowledgement?: (response: SocketAck<GroupSnapshot>) => void,
    ) => void;
    'group:respond': (
      payload: GroupRespondPayload,
      acknowledgement?: (response: SocketAck<GroupSnapshot>) => void,
    ) => void;
    'group:leave': (
      payload: GroupLeavePayload,
      acknowledgement?: (response: SocketAck<GroupSnapshot>) => void,
    ) => void;
  }

  interface ServerToClientEvents {
    'group:updated': (payload: GroupSnapshot) => void;
  }
}
