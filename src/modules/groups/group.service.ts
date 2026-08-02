import { randomUUID } from 'node:crypto';
import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { isActorWithinInteractionRange } from '../../common/rules/actor-interaction.js';
import type {
  GroupDetailsPayload,
  GroupInvitePayload,
  GroupMemberPayload,
  GroupSnapshot,
} from '../../contracts/group.events.js';
import { WorldEventsPublisher } from '../world/world-events.publisher.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { WorldStateService } from '../world/world-state.service.js';
import { GROUP_INVITE_TTL_MS, GROUP_MAX_MEMBERS, isGroupFull } from './group.rules.js';

interface StoredGroupMember {
  characterId: string;
  name: string;
  characterClass: PlayerSession['characterClass'];
  level: number;
  outfitKey: string;
  hp: number;
  maxHp: number;
}

interface GroupRecord {
  id: string;
  adminCharacterId: string;
  members: Map<string, StoredGroupMember>;
  createdAt: number;
}

interface GroupInviteRecord {
  id: string;
  inviterCharacterId: string;
  targetCharacterId: string;
  sourceGroupId?: string;
  inviter: StoredGroupMember;
  expiresAt: number;
}

@Injectable()
export class GroupService implements OnModuleDestroy {
  private readonly groups = new Map<string, GroupRecord>();
  private readonly groupIdByCharacter = new Map<string, string>();
  private readonly invites = new Map<string, GroupInviteRecord>();

  constructor(
    private readonly world: WorldStateService,
    private readonly publisher: WorldEventsPublisher,
  ) {}

  getSnapshot(session: PlayerSession): GroupSnapshot {
    this.pruneExpiredInvites();
    return this.snapshotFor(session.characterId);
  }

  getActivityRoster(actor: PlayerSession): PlayerSession[] {
    this.pruneExpiredInvites();
    const group = this.groupForCharacter(actor.characterId);
    if (!group) return [actor];
    if (group.adminCharacterId !== actor.characterId) {
      throw new GameError(GAME_ERROR_CODES.GROUP_FORBIDDEN, 'errors.group.forbidden');
    }
    const roster = [...group.members.keys()].map((characterId) => {
      const session = this.world.getByCharacterId(characterId);
      if (
        !session?.activeInWorld ||
        session.realmId !== actor.realmId ||
        session.combatState !== 'IDLE'
      ) {
        throw new GameError(
          GAME_ERROR_CODES.GROUP_PARTICIPANT_UNAVAILABLE,
          'errors.group.participantUnavailable',
        );
      }
      return session;
    });
    if (roster.length < 1 || roster.length > GROUP_MAX_MEMBERS) {
      throw new GameError(GAME_ERROR_CODES.GROUP_FULL, 'errors.group.full');
    }
    return roster;
  }

  getGroupCharacterIds(characterId: string): string[] {
    const group = this.groupForCharacter(characterId);
    return group ? [...group.members.keys()] : [characterId];
  }

  assembleFinderRoster(leader: PlayerSession, rawCharacterIds: readonly string[]): GroupSnapshot {
    this.pruneExpiredInvites();
    const characterIds = [...new Set(rawCharacterIds)];
    if (
      characterIds.length < 1 ||
      characterIds.length > GROUP_MAX_MEMBERS ||
      !characterIds.includes(leader.characterId)
    ) {
      throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid');
    }
    const sessions = characterIds.map((characterId) => {
      const session = this.world.getByCharacterId(characterId);
      if (
        !session?.activeInWorld ||
        session.realmId !== leader.realmId ||
        session.combatState !== 'IDLE'
      ) {
        throw new GameError(
          GAME_ERROR_CODES.GROUP_PARTICIPANT_UNAVAILABLE,
          'errors.group.participantUnavailable',
        );
      }
      return session;
    });

    const existing = this.groupForCharacter(leader.characterId);
    if (existing && existing.adminCharacterId !== leader.characterId) {
      throw new GameError(GAME_ERROR_CODES.GROUP_FORBIDDEN, 'errors.group.forbidden');
    }
    if (existing) {
      for (const existingCharacterId of existing.members.keys()) {
        if (!characterIds.includes(existingCharacterId)) {
          throw new GameError(GAME_ERROR_CODES.GROUP_FORBIDDEN, 'errors.group.forbidden');
        }
      }
    }
    for (const characterId of characterIds) {
      const currentGroup = this.groupForCharacter(characterId);
      if (currentGroup && currentGroup.id !== existing?.id) {
        throw new GameError(GAME_ERROR_CODES.GROUP_TARGET_MEMBER, 'errors.group.targetMember');
      }
    }

    if (characterIds.length === 1) {
      if (existing) {
        throw new GameError(GAME_ERROR_CODES.GROUP_FORBIDDEN, 'errors.group.forbidden');
      }
      return this.snapshotFor(leader.characterId);
    }

    const group = existing ?? this.createGroup(leader);
    for (const session of sessions) {
      group.members.set(session.characterId, this.storeMember(session));
      this.groupIdByCharacter.set(session.characterId, group.id);
      this.removeInvitesForTarget(session.characterId);
    }
    this.publishGroup(group);
    return this.snapshotFor(leader.characterId);
  }

  invite(actor: PlayerSession, targetCharacterId: string): GroupSnapshot {
    this.pruneExpiredInvites();
    if (actor.characterId === targetCharacterId) {
      throw new GameError(GAME_ERROR_CODES.GROUP_SELF, 'errors.group.self');
    }

    const actorGroup = this.groupForCharacter(actor.characterId);
    if (actorGroup && actorGroup.adminCharacterId !== actor.characterId) {
      throw new GameError(GAME_ERROR_CODES.GROUP_FORBIDDEN, 'errors.group.forbidden');
    }

    const target = this.world.getByCharacterId(targetCharacterId);
    if (
      !target?.activeInWorld ||
      target.realmId !== actor.realmId ||
      actor.combatState !== 'IDLE' ||
      target.combatState !== 'IDLE'
    ) {
      throw new GameError(
        GAME_ERROR_CODES.GROUP_PARTICIPANT_UNAVAILABLE,
        'errors.group.participantUnavailable',
      );
    }
    if (!isActorWithinInteractionRange(actor, target)) {
      throw new GameError(GAME_ERROR_CODES.GROUP_TOO_FAR, 'errors.group.tooFar');
    }
    if (this.groupIdByCharacter.has(targetCharacterId)) {
      throw new GameError(GAME_ERROR_CODES.GROUP_TARGET_MEMBER, 'errors.group.targetMember');
    }
    if (actorGroup && isGroupFull(actorGroup.members.size)) {
      throw new GameError(GAME_ERROR_CODES.GROUP_FULL, 'errors.group.full');
    }

    const duplicate = [...this.invites.values()].some(
      (invite) =>
        invite.targetCharacterId === targetCharacterId &&
        (invite.inviterCharacterId === actor.characterId ||
          (actorGroup ? invite.sourceGroupId === actorGroup.id : false)),
    );
    if (duplicate) {
      throw new GameError(GAME_ERROR_CODES.GROUP_INVITE_EXISTS, 'errors.group.inviteExists');
    }

    const invite: GroupInviteRecord = {
      id: randomUUID(),
      inviterCharacterId: actor.characterId,
      targetCharacterId,
      ...(actorGroup ? { sourceGroupId: actorGroup.id } : {}),
      inviter: this.storeMember(actor),
      expiresAt: Date.now() + GROUP_INVITE_TTL_MS,
    };
    this.invites.set(invite.id, invite);
    this.publishTo([targetCharacterId]);
    return this.snapshotFor(actor.characterId);
  }

  respond(target: PlayerSession, inviteId: string, accept: boolean): GroupSnapshot {
    this.pruneExpiredInvites();
    const invite = this.invites.get(inviteId);
    if (!invite || invite.targetCharacterId !== target.characterId) {
      throw new GameError(GAME_ERROR_CODES.GROUP_INVITE_NOT_FOUND, 'errors.group.inviteNotFound');
    }
    if (invite.expiresAt <= Date.now()) {
      this.invites.delete(invite.id);
      throw new GameError(GAME_ERROR_CODES.GROUP_INVITE_EXPIRED, 'errors.group.inviteExpired');
    }

    if (!accept) {
      this.invites.delete(invite.id);
      this.publishTo([target.characterId]);
      return this.snapshotFor(target.characterId);
    }
    if (this.groupIdByCharacter.has(target.characterId)) {
      this.invites.delete(invite.id);
      throw new GameError(GAME_ERROR_CODES.GROUP_ALREADY_MEMBER, 'errors.group.alreadyMember');
    }

    const inviter = this.world.getByCharacterId(invite.inviterCharacterId);
    if (
      !inviter?.activeInWorld ||
      inviter.realmId !== target.realmId ||
      inviter.combatState !== 'IDLE' ||
      target.combatState !== 'IDLE'
    ) {
      throw new GameError(
        GAME_ERROR_CODES.GROUP_PARTICIPANT_UNAVAILABLE,
        'errors.group.participantUnavailable',
      );
    }

    let group = this.groupForCharacter(inviter.characterId);
    const invitationStillOwnedByAdmin = group?.adminCharacterId === inviter.characterId;
    if (
      (invite.sourceGroupId &&
        (group?.id !== invite.sourceGroupId || !invitationStillOwnedByAdmin)) ||
      (!invite.sourceGroupId && group && !invitationStillOwnedByAdmin)
    ) {
      this.invites.delete(invite.id);
      throw new GameError(
        GAME_ERROR_CODES.GROUP_INVITE_NOT_FOUND,
        'errors.group.inviteNotFound',
      );
    }
    if (group && isGroupFull(group.members.size)) {
      throw new GameError(GAME_ERROR_CODES.GROUP_FULL, 'errors.group.full');
    }
    if (!group) group = this.createGroup(inviter);

    this.invites.delete(invite.id);
    group.members.set(target.characterId, this.storeMember(target));
    this.groupIdByCharacter.set(target.characterId, group.id);
    this.removeInvitesForTarget(target.characterId);
    this.publishGroup(group);
    return this.snapshotFor(target.characterId);
  }

  kick(actor: PlayerSession, targetCharacterId: string): GroupSnapshot {
    this.pruneExpiredInvites();
    const group = this.groupForCharacter(actor.characterId);
    if (!group) {
      throw new GameError(GAME_ERROR_CODES.GROUP_REQUIRED, 'errors.group.required');
    }
    if (group.adminCharacterId !== actor.characterId) {
      throw new GameError(GAME_ERROR_CODES.GROUP_FORBIDDEN, 'errors.group.forbidden');
    }
    if (targetCharacterId === actor.characterId) {
      throw new GameError(
        GAME_ERROR_CODES.GROUP_ADMIN_CANNOT_KICK_SELF,
        'errors.group.adminCannotKickSelf',
      );
    }
    if (!group.members.has(targetCharacterId)) {
      throw new GameError(
        GAME_ERROR_CODES.GROUP_MEMBER_NOT_FOUND,
        'errors.group.memberNotFound',
      );
    }

    const previousMemberIds = [...group.members.keys()];
    group.members.delete(targetCharacterId);
    this.groupIdByCharacter.delete(targetCharacterId);
    this.removeInvitesFrom(targetCharacterId);
    this.removeInvitesForTarget(targetCharacterId);

    if (group.members.size <= 1) {
      for (const characterId of group.members.keys()) this.groupIdByCharacter.delete(characterId);
      this.groups.delete(group.id);
      this.removeInvitesForGroup(group.id);
    }

    this.publishTo(previousMemberIds);
    return this.snapshotFor(actor.characterId);
  }

  leave(actor: PlayerSession): GroupSnapshot {
    this.pruneExpiredInvites();
    const group = this.groupForCharacter(actor.characterId);
    if (!group) {
      throw new GameError(GAME_ERROR_CODES.GROUP_REQUIRED, 'errors.group.required');
    }

    const previousMemberIds = [...group.members.keys()];
    const adminLeaving = group.adminCharacterId === actor.characterId;
    group.members.delete(actor.characterId);
    this.groupIdByCharacter.delete(actor.characterId);
    this.removeInvitesFrom(actor.characterId);
    if (adminLeaving) this.removeInvitesForGroup(group.id);

    if (group.members.size <= 1) {
      for (const characterId of group.members.keys()) this.groupIdByCharacter.delete(characterId);
      this.groups.delete(group.id);
      this.removeInvitesForGroup(group.id);
      this.publishTo(previousMemberIds);
      return this.snapshotFor(actor.characterId);
    }

    if (adminLeaving) {
      const nextAdminCharacterId = group.members.keys().next().value;
      if (!nextAdminCharacterId) {
        throw new Error('A non-empty group must always have an administrator.');
      }
      group.adminCharacterId = nextAdminCharacterId;
    }
    this.publishTo(previousMemberIds);
    return this.snapshotFor(actor.characterId);
  }

  onModuleDestroy(): void {
    this.groups.clear();
    this.groupIdByCharacter.clear();
    this.invites.clear();
  }

  private createGroup(admin: PlayerSession): GroupRecord {
    const group: GroupRecord = {
      id: randomUUID(),
      adminCharacterId: admin.characterId,
      members: new Map([[admin.characterId, this.storeMember(admin)]]),
      createdAt: Date.now(),
    };
    this.groups.set(group.id, group);
    this.groupIdByCharacter.set(admin.characterId, group.id);
    return group;
  }

  private snapshotFor(characterId: string): GroupSnapshot {
    const group = this.groupForCharacter(characterId);
    const now = Date.now();
    return {
      group: group ? this.groupPayload(group) : null,
      invites: [...this.invites.values()]
        .filter((invite) => invite.targetCharacterId === characterId && invite.expiresAt > now)
        .sort((left, right) => right.expiresAt - left.expiresAt)
        .map((invite) => this.invitePayload(invite)),
    };
  }

  private groupPayload(group: GroupRecord): GroupDetailsPayload {
    const members = [...group.members.values()].map((stored) =>
      this.memberPayload(stored, group.adminCharacterId),
    );
    members.sort((left, right) => {
      if (left.admin !== right.admin) return left.admin ? -1 : 1;
      if (left.online !== right.online) return left.online ? -1 : 1;
      return left.name.localeCompare(right.name, 'pl');
    });
    return {
      id: group.id,
      adminCharacterId: group.adminCharacterId,
      maxMembers: GROUP_MAX_MEMBERS,
      members,
    };
  }

  private memberPayload(stored: StoredGroupMember, adminCharacterId: string): GroupMemberPayload {
    const live = this.world.getByCharacterId(stored.characterId);
    const source = live?.activeInWorld ? this.storeMember(live) : stored;
    if (live?.activeInWorld) {
      const group = this.groupForCharacter(stored.characterId);
      group?.members.set(stored.characterId, source);
    }
    return {
      ...source,
      online: Boolean(live?.activeInWorld),
      admin: stored.characterId === adminCharacterId,
    };
  }

  private invitePayload(invite: GroupInviteRecord): GroupInvitePayload {
    const live = this.world.getByCharacterId(invite.inviterCharacterId);
    const inviter = live?.activeInWorld ? this.storeMember(live) : invite.inviter;
    return {
      inviteId: invite.id,
      inviterCharacterId: invite.inviterCharacterId,
      inviterName: inviter.name,
      inviterLevel: inviter.level,
      inviterOutfitKey: inviter.outfitKey,
      inviterClass: inviter.characterClass,
      expiresAt: invite.expiresAt,
    };
  }

  private storeMember(session: PlayerSession): StoredGroupMember {
    return {
      characterId: session.characterId,
      name: session.name,
      characterClass: session.characterClass,
      level: session.level,
      outfitKey: session.outfitKey,
      hp: session.hp,
      maxHp: session.maxHp,
    };
  }

  private groupForCharacter(characterId: string): GroupRecord | undefined {
    const groupId = this.groupIdByCharacter.get(characterId);
    return groupId ? this.groups.get(groupId) : undefined;
  }

  private publishGroup(group: GroupRecord): void {
    this.publishTo([...group.members.keys()]);
  }

  private publishTo(characterIds: Iterable<string>): void {
    for (const characterId of new Set(characterIds)) {
      const session = this.world.getByCharacterId(characterId);
      if (session?.activeInWorld) {
        this.publisher.emit(session.socketId, 'group:updated', this.snapshotFor(characterId));
      }
    }
  }

  private pruneExpiredInvites(): void {
    const now = Date.now();
    for (const [inviteId, invite] of this.invites) {
      if (invite.expiresAt <= now) this.invites.delete(inviteId);
    }
  }

  private removeInvitesForTarget(characterId: string): void {
    for (const [inviteId, invite] of this.invites) {
      if (invite.targetCharacterId === characterId) this.invites.delete(inviteId);
    }
  }

  private removeInvitesFrom(characterId: string): void {
    for (const [inviteId, invite] of this.invites) {
      if (invite.inviterCharacterId === characterId) this.invites.delete(inviteId);
    }
  }

  private removeInvitesForGroup(groupId: string): void {
    for (const [inviteId, invite] of this.invites) {
      if (invite.sourceGroupId === groupId) this.invites.delete(inviteId);
    }
  }
}
