import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { GuildChatMessagePayload, GuildSnapshot } from '../../contracts/guild.events.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { WorldEventsPublisher } from '../world/world-events.publisher.js';
import { WorldStateService } from '../world/world-state.service.js';
import {
  GUILD_DESCRIPTION_MAX_LENGTH,
  GUILD_INVITE_TTL_MS,
  GUILD_MAX_MEMBERS,
  canEditDescription,
  canInvite,
  canKick,
  canSetRole,
  isGuildNameValid,
  isGuildTagValid,
  normalizeGuildDescription,
  normalizeGuildName,
  normalizeGuildTag,
  type GuildRoleValue,
} from './guild.rules.js';

const guildInclude = {
  members: {
    include: {
      character: { select: { id: true, name: true, level: true } },
    },
    orderBy: { joinedAt: 'asc' as const },
  },
};

type GuildWithMembers = Prisma.GuildGetPayload<{ include: typeof guildInclude }>;
type OwnedCharacter = { id: string; userId: string; realmId: string; name: string };
type GuildActor = Prisma.GuildMemberGetPayload<{
  include: { character: { select: { realmId: true } } };
}>;

const roleOrder: Record<GuildRoleValue, number> = { LEADER: 0, OFFICER: 1, MEMBER: 2 };

@Injectable()
export class GuildService {
  private readonly logger = new Logger(GuildService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly world: WorldStateService,
    private readonly publisher: WorldEventsPublisher,
  ) {}

  async getSnapshot(userId: string, characterId: string): Promise<GuildSnapshot> {
    await this.owner(userId, characterId);
    await this.expireInvites(characterId);
    const membership = await this.prisma.guildMember.findUnique({
      where: { characterId },
      include: { guild: { include: guildInclude } },
    });
    const invites = await this.prisma.guildInvite.findMany({
      where: { targetCharacterId: characterId, status: 'PENDING', expiresAt: { gt: new Date() } },
      include: {
        guild: { select: { id: true, name: true, tag: true } },
        inviter: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      guild: membership
        ? this.guildPayload(membership.guild, membership.role as GuildRoleValue)
        : null,
      invites: invites.map((invite) => ({
        inviteId: invite.id,
        guildId: invite.guild.id,
        guildName: invite.guild.name,
        guildTag: invite.guild.tag,
        inviterName: invite.inviter.name,
        expiresAt: invite.expiresAt.getTime(),
      })),
    };
  }

  async create(
    userId: string,
    characterId: string,
    input: { name: string; tag: string; description: string },
  ): Promise<GuildSnapshot> {
    const character = await this.owner(userId, characterId);
    const name = normalizeGuildName(input.name);
    const nameKey = name.toLocaleLowerCase('en-US');
    const tag = normalizeGuildTag(input.tag);
    const description = normalizeGuildDescription(input.description);
    if (!isGuildNameValid(name) || !isGuildTagValid(tag) || description.length > GUILD_DESCRIPTION_MAX_LENGTH) {
      throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.lockRealm(tx, character.realmId);
      if (await tx.guildMember.findUnique({ where: { characterId }, select: { id: true } })) {
        throw new GameError(GAME_ERROR_CODES.GUILD_ALREADY_MEMBER, 'errors.guild.alreadyMember');
      }
      const conflict = await tx.guild.findFirst({
        where: { realmId: character.realmId, OR: [{ nameKey }, { tag }] },
        select: { nameKey: true, tag: true },
      });
      if (conflict?.nameKey === nameKey) {
        throw new GameError(GAME_ERROR_CODES.GUILD_NAME_TAKEN, 'errors.guild.nameTaken');
      }
      if (conflict?.tag === tag) {
        throw new GameError(GAME_ERROR_CODES.GUILD_TAG_TAKEN, 'errors.guild.tagTaken');
      }
      const guild = await tx.guild.create({
        data: { realmId: character.realmId, name, nameKey, tag, description },
        select: { id: true },
      });
      await tx.guildMember.create({ data: { guildId: guild.id, characterId, role: 'LEADER' } });
      await tx.guildInvite.updateMany({
        where: { targetCharacterId: characterId, status: 'PENDING' },
        data: { status: 'CANCELLED', respondedAt: new Date() },
      });
    });
    await this.broadcastCharacters([characterId]);
    return this.getSnapshot(userId, characterId);
  }

  async invite(userId: string, characterId: string, characterName: string): Promise<GuildSnapshot> {
    const actor = await this.member(userId, characterId);
    if (!canInvite(actor.role as GuildRoleValue)) {
      throw new GameError(GAME_ERROR_CODES.GUILD_FORBIDDEN, 'errors.guild.forbidden');
    }
    const targetName = characterName.normalize('NFKC').trim();
    const target = await this.prisma.character.findFirst({
      where: { realmId: actor.character.realmId, name: { equals: targetName, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!target) {
      throw new GameError(GAME_ERROR_CODES.CHARACTER_NOT_FOUND, 'errors.guild.characterNotFound');
    }
    if (target.id === characterId) {
      throw new GameError(GAME_ERROR_CODES.GUILD_SELF_INVITE, 'errors.guild.selfInvite');
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.lockGuild(tx, actor.guildId);
      const currentActor = await this.txMember(tx, characterId, actor.guildId);
      if (!canInvite(currentActor.role as GuildRoleValue)) {
        throw new GameError(GAME_ERROR_CODES.GUILD_FORBIDDEN, 'errors.guild.forbidden');
      }
      if (await tx.guildMember.findUnique({ where: { characterId: target.id }, select: { id: true } })) {
        throw new GameError(GAME_ERROR_CODES.GUILD_TARGET_MEMBER, 'errors.guild.targetMember');
      }
      if (await tx.guildMember.count({ where: { guildId: actor.guildId } }) >= GUILD_MAX_MEMBERS) {
        throw new GameError(GAME_ERROR_CODES.GUILD_FULL, 'errors.guild.full');
      }
      await tx.guildInvite.updateMany({
        where: { guildId: actor.guildId, targetCharacterId: target.id, status: 'PENDING', expiresAt: { lte: now } },
        data: { status: 'EXPIRED', respondedAt: now },
      });
      if (await tx.guildInvite.findFirst({
        where: { guildId: actor.guildId, targetCharacterId: target.id, status: 'PENDING', expiresAt: { gt: now } },
        select: { id: true },
      })) {
        throw new GameError(GAME_ERROR_CODES.GUILD_INVITE_EXISTS, 'errors.guild.inviteExists');
      }
      await tx.guildInvite.create({
        data: {
          guildId: actor.guildId,
          inviterCharacterId: characterId,
          targetCharacterId: target.id,
          expiresAt: new Date(Date.now() + GUILD_INVITE_TTL_MS),
        },
      });
    });
    await this.broadcastCharacters([target.id]);
    return this.getSnapshot(userId, characterId);
  }

  async respond(userId: string, characterId: string, inviteId: string, accept: boolean): Promise<GuildSnapshot> {
    await this.owner(userId, characterId);
    const invite = await this.prisma.guildInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.targetCharacterId !== characterId || invite.status !== 'PENDING') {
      throw new GameError(GAME_ERROR_CODES.GUILD_INVITE_NOT_FOUND, 'errors.guild.inviteNotFound');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.lockGuild(tx, invite.guildId);
      const current = await tx.guildInvite.findUnique({ where: { id: invite.id } });
      if (!current || current.targetCharacterId !== characterId || current.status !== 'PENDING') {
        throw new GameError(GAME_ERROR_CODES.GUILD_INVITE_NOT_FOUND, 'errors.guild.inviteNotFound');
      }
      if (current.expiresAt.getTime() <= Date.now()) {
        await tx.guildInvite.update({
          where: { id: current.id },
          data: { status: 'EXPIRED', respondedAt: new Date() },
        });
        throw new GameError(GAME_ERROR_CODES.GUILD_INVITE_EXPIRED, 'errors.guild.inviteExpired');
      }
      if (!accept) {
        await tx.guildInvite.update({
          where: { id: current.id },
          data: { status: 'DECLINED', respondedAt: new Date() },
        });
        return;
      }
      if (await tx.guildMember.findUnique({ where: { characterId }, select: { id: true } })) {
        throw new GameError(GAME_ERROR_CODES.GUILD_ALREADY_MEMBER, 'errors.guild.alreadyMember');
      }
      if (await tx.guildMember.count({ where: { guildId: current.guildId } }) >= GUILD_MAX_MEMBERS) {
        throw new GameError(GAME_ERROR_CODES.GUILD_FULL, 'errors.guild.full');
      }
      await tx.guildMember.create({ data: { guildId: current.guildId, characterId, role: 'MEMBER' } });
      await tx.guildInvite.update({
        where: { id: current.id },
        data: { status: 'ACCEPTED', respondedAt: new Date() },
      });
      await tx.guildInvite.updateMany({
        where: { targetCharacterId: characterId, status: 'PENDING', id: { not: current.id } },
        data: { status: 'CANCELLED', respondedAt: new Date() },
      });
    });
    await this.broadcastGuild(invite.guildId, [characterId]);
    return this.getSnapshot(userId, characterId);
  }

  async updateDescription(userId: string, characterId: string, rawDescription: string): Promise<GuildSnapshot> {
    const actor = await this.member(userId, characterId);
    const description = normalizeGuildDescription(rawDescription);
    if (description.length > GUILD_DESCRIPTION_MAX_LENGTH) {
      throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.lockGuild(tx, actor.guildId);
      const currentActor = await this.txMember(tx, characterId, actor.guildId);
      if (!canEditDescription(currentActor.role as GuildRoleValue)) {
        throw new GameError(GAME_ERROR_CODES.GUILD_FORBIDDEN, 'errors.guild.forbidden');
      }
      await tx.guild.update({ where: { id: actor.guildId }, data: { description } });
    });
    await this.broadcastGuild(actor.guildId);
    return this.getSnapshot(userId, characterId);
  }

  async setRole(
    userId: string,
    characterId: string,
    targetCharacterId: string,
    nextRole: 'OFFICER' | 'MEMBER',
  ): Promise<GuildSnapshot> {
    const actor = await this.member(userId, characterId);
    await this.prisma.$transaction(async (tx) => {
      await this.lockGuild(tx, actor.guildId);
      const currentActor = await this.txMember(tx, characterId, actor.guildId);
      const target = await this.txMember(tx, targetCharacterId, actor.guildId);
      if (!canSetRole(currentActor.role as GuildRoleValue, target.role as GuildRoleValue, nextRole)) {
        throw new GameError(GAME_ERROR_CODES.GUILD_FORBIDDEN, 'errors.guild.forbidden');
      }
      await tx.guildMember.update({ where: { characterId: targetCharacterId }, data: { role: nextRole } });
    });
    await this.broadcastGuild(actor.guildId);
    return this.getSnapshot(userId, characterId);
  }

  async kick(userId: string, characterId: string, targetCharacterId: string): Promise<GuildSnapshot> {
    const actor = await this.member(userId, characterId);
    if (targetCharacterId === characterId) {
      throw new GameError(GAME_ERROR_CODES.GUILD_FORBIDDEN, 'errors.guild.forbidden');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.lockGuild(tx, actor.guildId);
      const currentActor = await this.txMember(tx, characterId, actor.guildId);
      const target = await this.txMember(tx, targetCharacterId, actor.guildId);
      if (!canKick(currentActor.role as GuildRoleValue, target.role as GuildRoleValue)) {
        throw new GameError(GAME_ERROR_CODES.GUILD_FORBIDDEN, 'errors.guild.forbidden');
      }
      await tx.guildMember.delete({ where: { characterId: targetCharacterId } });
    });
    await this.broadcastGuild(actor.guildId, [targetCharacterId]);
    return this.getSnapshot(userId, characterId);
  }

  async leave(userId: string, characterId: string): Promise<GuildSnapshot> {
    const actor = await this.member(userId, characterId);
    await this.prisma.$transaction(async (tx) => {
      await this.lockGuild(tx, actor.guildId);
      const currentActor = await this.txMember(tx, characterId, actor.guildId);
      if (currentActor.role === 'LEADER') {
        throw new GameError(GAME_ERROR_CODES.GUILD_LEADER_CANNOT_LEAVE, 'errors.guild.leaderCannotLeave');
      }
      await tx.guildMember.delete({ where: { characterId } });
    });
    await this.broadcastGuild(actor.guildId, [characterId]);
    return this.getSnapshot(userId, characterId);
  }

  async transferLeadership(userId: string, characterId: string, targetCharacterId: string): Promise<GuildSnapshot> {
    const actor = await this.member(userId, characterId);
    if (targetCharacterId === characterId) {
      throw new GameError(GAME_ERROR_CODES.GUILD_FORBIDDEN, 'errors.guild.forbidden');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.lockGuild(tx, actor.guildId);
      const currentActor = await this.txMember(tx, characterId, actor.guildId);
      await this.txMember(tx, targetCharacterId, actor.guildId);
      if (currentActor.role !== 'LEADER') {
        throw new GameError(GAME_ERROR_CODES.GUILD_FORBIDDEN, 'errors.guild.forbidden');
      }
      await tx.guildMember.update({ where: { characterId }, data: { role: 'OFFICER' } });
      await tx.guildMember.update({ where: { characterId: targetCharacterId }, data: { role: 'LEADER' } });
    });
    await this.broadcastGuild(actor.guildId);
    return this.getSnapshot(userId, characterId);
  }

  async disband(userId: string, characterId: string): Promise<GuildSnapshot> {
    const actor = await this.member(userId, characterId);
    const memberIds = await this.prisma.$transaction(async (tx) => {
      await this.lockGuild(tx, actor.guildId);
      const currentActor = await this.txMember(tx, characterId, actor.guildId);
      if (currentActor.role !== 'LEADER') {
        throw new GameError(GAME_ERROR_CODES.GUILD_FORBIDDEN, 'errors.guild.forbidden');
      }
      const affected = await tx.guildMember.findMany({
        where: { guildId: actor.guildId },
        select: { characterId: true },
      });
      await tx.guild.delete({ where: { id: actor.guildId } });
      return affected.map((member) => member.characterId);
    });
    await this.broadcastCharacters(memberIds);
    return this.getSnapshot(userId, characterId);
  }

  async sendChat(input: { userId: string; characterId: string; author: string; text: string }): Promise<GuildChatMessagePayload> {
    const guildId = await this.getGuildId(input.userId, input.characterId);
    if (!guildId) {
      throw new GameError(GAME_ERROR_CODES.GUILD_REQUIRED, 'errors.guild.required');
    }
    const memberIds = new Set(await this.memberIds(guildId));
    const message: GuildChatMessagePayload = {
      id: randomUUID(), characterId: input.characterId, author: input.author,
      text: input.text, guildId, sentAt: Date.now(),
    };
    for (const session of this.world.listSessions()) {
      if (session.activeInWorld && memberIds.has(session.characterId)) {
        this.publisher.emit(session.socketId, 'guild:chatMessage', message);
      }
    }
    return message;
  }

  async getGuildId(userId: string, characterId: string): Promise<string | null> {
    const membership = await this.prisma.guildMember.findUnique({
      where: { characterId },
      include: { character: { select: { userId: true } } },
    });
    if (!membership || membership.character.userId !== userId) return null;
    return membership.guildId;
  }

  private async owner(userId: string, characterId: string): Promise<OwnedCharacter> {
    const character = await this.prisma.character.findFirst({
      where: { id: characterId, userId },
      select: { id: true, userId: true, realmId: true, name: true },
    });
    if (!character) throw new GameError(GAME_ERROR_CODES.CHARACTER_NOT_FOUND, 'errors.character.required');
    return character;
  }

  private async member(userId: string, characterId: string): Promise<GuildActor> {
    await this.owner(userId, characterId);
    const membership = await this.prisma.guildMember.findUnique({
      where: { characterId },
      include: { character: { select: { realmId: true } } },
    });
    if (!membership) throw new GameError(GAME_ERROR_CODES.GUILD_REQUIRED, 'errors.guild.required');
    return membership;
  }

  private async txMember(tx: Prisma.TransactionClient, characterId: string, guildId: string) {
    const membership = await tx.guildMember.findUnique({ where: { characterId } });
    if (!membership || membership.guildId !== guildId) {
      throw new GameError(GAME_ERROR_CODES.GUILD_MEMBER_NOT_FOUND, 'errors.guild.memberNotFound');
    }
    return membership;
  }

  private guildPayload(guild: GuildWithMembers, role: GuildRoleValue): NonNullable<GuildSnapshot['guild']> {
    const members = [...guild.members].sort((left, right) =>
      roleOrder[left.role as GuildRoleValue] - roleOrder[right.role as GuildRoleValue] ||
      left.joinedAt.getTime() - right.joinedAt.getTime(),
    );
    return {
      id: guild.id, name: guild.name, tag: guild.tag, description: guild.description,
      level: guild.level, experience: guild.experience, role,
      members: members.map((member) => ({
        characterId: member.character.id,
        name: member.character.name,
        level: member.character.level,
        role: member.role as GuildRoleValue,
        online: Boolean(this.world.getByCharacterId(member.character.id)?.activeInWorld),
        joinedAt: member.joinedAt.getTime(),
      })),
    };
  }

  private async expireInvites(characterId: string): Promise<void> {
    await this.prisma.guildInvite.updateMany({
      where: { targetCharacterId: characterId, status: 'PENDING', expiresAt: { lte: new Date() } },
      data: { status: 'EXPIRED', respondedAt: new Date() },
    });
  }

  private async memberIds(guildId: string): Promise<string[]> {
    return (await this.prisma.guildMember.findMany({ where: { guildId }, select: { characterId: true } }))
      .map((member) => member.characterId);
  }

  private async lockRealm(tx: Prisma.TransactionClient, realmId: string): Promise<void> {
    await tx.$queryRawUnsafe('SELECT "id" FROM "Realm" WHERE "id" = $1::uuid FOR UPDATE', realmId);
  }

  private async lockGuild(tx: Prisma.TransactionClient, guildId: string): Promise<void> {
    const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      'SELECT "id" FROM "Guild" WHERE "id" = $1::uuid FOR UPDATE',
      guildId,
    );
    if (rows.length === 0) {
      throw new GameError(GAME_ERROR_CODES.GUILD_REQUIRED, 'errors.guild.required');
    }
  }

  private async broadcastGuild(guildId: string, extraCharacterIds: string[] = []): Promise<void> {
    await this.broadcastCharacters([...(await this.memberIds(guildId)), ...extraCharacterIds]);
  }

  private async broadcastCharacters(characterIds: string[]): Promise<void> {
    await Promise.all([...new Set(characterIds)].map(async (characterId) => {
      const session = this.world.getByCharacterId(characterId);
      if (!session?.activeInWorld) return;
      try {
        this.publisher.emit(session.socketId, 'guild:updated', await this.getSnapshot(session.userId, characterId));
      } catch (error) {
        this.logger.warn(`Could not publish guild snapshot for character ${characterId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }));
  }
}
