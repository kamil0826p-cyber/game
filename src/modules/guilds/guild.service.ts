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
  GUILD_MAX_EXPERIENCE_UPGRADE_LEVEL,
  GUILD_MAX_MEMBERS,
  canEditDescription,
  canInvite,
  canKick,
  canManageGuildTreasury,
  canSetRole,
  guildExperienceBonusPercent,
  guildExperienceUpgradeCost,
  isGuildNameValid,
  isGuildTagValid,
  isGuildTreasuryAmountValid,
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
  treasuryTransactions: {
    orderBy: { createdAt: 'desc' as const },
    take: 20,
  },
};

type GuildWithMembers = Prisma.GuildGetPayload<{ include: typeof guildInclude }>;
type OwnedCharacter = {
  id: string;
  userId: string;
  realmId: string;
  name: string;
  silver: number;
};
type GuildActor = Prisma.GuildMemberGetPayload<{
  include: { character: { select: { realmId: true; name: true } } };
}>;
type TreasuryTransactionType = 'DEPOSIT' | 'WITHDRAWAL' | 'UPGRADE_PURCHASE';

const roleOrder: Record<GuildRoleValue, number> = { LEADER: 0, OFFICER: 1, MEMBER: 2 };
const MAX_DATABASE_INT = 2_147_483_647;

@Injectable()
export class GuildService {
  private readonly logger = new Logger(GuildService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly world: WorldStateService,
    private readonly publisher: WorldEventsPublisher,
  ) {}

  async getSnapshot(userId: string, characterId: string): Promise<GuildSnapshot> {
    const character = await this.owner(userId, characterId);
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
      characterSilver: character.silver,
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

  async depositSilver(
    userId: string,
    characterId: string,
    amount: number,
    operationId: string,
  ): Promise<GuildSnapshot> {
    if (!isGuildTreasuryAmountValid(amount)) {
      throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid');
    }
    const actor = await this.member(userId, characterId);
    await this.prisma.$transaction(async (tx) => {
      await this.lockGuild(tx, actor.guildId);
      await this.lockCharacter(tx, characterId);
      const currentMember = await this.txMember(tx, characterId, actor.guildId);
      if (await this.replayedTransaction(tx, actor.guildId, operationId, 'DEPOSIT', characterId, amount)) return;
      const character = await tx.character.findUnique({
        where: { id: characterId },
        select: { userId: true, silver: true },
      });
      if (!character || character.userId !== userId) {
        throw new GameError(GAME_ERROR_CODES.CHARACTER_NOT_FOUND, 'errors.character.required');
      }
      if (character.silver < amount) {
        throw new GameError(GAME_ERROR_CODES.INSUFFICIENT_SILVER, 'errors.items.insufficientSilver', {
          balance: character.silver,
          required: amount,
        });
      }
      const currentGuild = await tx.guild.findUnique({
        where: { id: actor.guildId },
        select: { treasurySilver: true, totalSilverDeposited: true },
      });
      if (
        !currentGuild ||
        currentGuild.treasurySilver > MAX_DATABASE_INT - amount ||
        currentGuild.totalSilverDeposited > MAX_DATABASE_INT - amount ||
        currentMember.contributedSilver > MAX_DATABASE_INT - amount
      ) {
        throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid', {
          reason: 'GUILD_TREASURY_LIMIT',
        });
      }
      const guild = await tx.guild.update({
        where: { id: actor.guildId },
        data: {
          treasurySilver: { increment: amount },
          totalSilverDeposited: { increment: amount },
        },
        select: { treasurySilver: true },
      });
      await tx.character.update({
        where: { id: characterId },
        data: {
          silver: { decrement: amount },
          stateVersion: { increment: 1 },
          lastSavedAt: new Date(),
        },
      });
      await tx.guildMember.update({
        where: { characterId },
        data: {
          contributedSilver: { increment: amount },
          lastContributionAt: new Date(),
        },
      });
      await tx.guildTreasuryTransaction.create({
        data: {
          guildId: actor.guildId,
          operationId,
          actorCharacterId: characterId,
          actorName: actor.character.name,
          type: 'DEPOSIT',
          amount,
          balanceAfter: guild.treasurySilver,
        },
      });
    });
    await this.broadcastGuild(actor.guildId);
    return this.getSnapshot(userId, characterId);
  }

  async withdrawSilver(
    userId: string,
    characterId: string,
    amount: number,
    operationId: string,
  ): Promise<GuildSnapshot> {
    if (!isGuildTreasuryAmountValid(amount)) {
      throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid');
    }
    const actor = await this.member(userId, characterId);
    await this.prisma.$transaction(async (tx) => {
      await this.lockGuild(tx, actor.guildId);
      await this.lockCharacter(tx, characterId);
      const currentActor = await this.txMember(tx, characterId, actor.guildId);
      if (!canManageGuildTreasury(currentActor.role as GuildRoleValue)) {
        throw new GameError(GAME_ERROR_CODES.GUILD_FORBIDDEN, 'errors.guild.forbidden');
      }
      if (await this.replayedTransaction(tx, actor.guildId, operationId, 'WITHDRAWAL', characterId, amount)) return;
      const guild = await tx.guild.findUnique({
        where: { id: actor.guildId },
        select: { treasurySilver: true, totalSilverWithdrawn: true },
      });
      const character = await tx.character.findUnique({
        where: { id: characterId },
        select: { userId: true, silver: true },
      });
      if (!guild || !character || character.userId !== userId) {
        throw new GameError(GAME_ERROR_CODES.GUILD_REQUIRED, 'errors.guild.required');
      }
      if (guild.treasurySilver < amount) {
        throw new GameError(GAME_ERROR_CODES.INSUFFICIENT_SILVER, 'errors.items.insufficientSilver', {
          source: 'GUILD_TREASURY',
          balance: guild.treasurySilver,
          required: amount,
        });
      }
      if (
        character.silver > MAX_DATABASE_INT - amount ||
        guild.totalSilverWithdrawn > MAX_DATABASE_INT - amount
      ) {
        throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid', {
          reason: 'GUILD_TREASURY_LIMIT',
        });
      }
      const updatedGuild = await tx.guild.update({
        where: { id: actor.guildId },
        data: {
          treasurySilver: { decrement: amount },
          totalSilverWithdrawn: { increment: amount },
        },
        select: { treasurySilver: true },
      });
      await tx.character.update({
        where: { id: characterId },
        data: {
          silver: { increment: amount },
          stateVersion: { increment: 1 },
          lastSavedAt: new Date(),
        },
      });
      await tx.guildTreasuryTransaction.create({
        data: {
          guildId: actor.guildId,
          operationId,
          actorCharacterId: characterId,
          actorName: actor.character.name,
          type: 'WITHDRAWAL',
          amount,
          balanceAfter: updatedGuild.treasurySilver,
        },
      });
    });
    await this.broadcastGuild(actor.guildId);
    return this.getSnapshot(userId, characterId);
  }

  async purchaseExperienceUpgrade(
    userId: string,
    characterId: string,
    operationId: string,
  ): Promise<GuildSnapshot> {
    const actor = await this.member(userId, characterId);
    await this.prisma.$transaction(async (tx) => {
      await this.lockGuild(tx, actor.guildId);
      const currentActor = await this.txMember(tx, characterId, actor.guildId);
      if (!canManageGuildTreasury(currentActor.role as GuildRoleValue)) {
        throw new GameError(GAME_ERROR_CODES.GUILD_FORBIDDEN, 'errors.guild.forbidden');
      }
      const replay = await tx.guildTreasuryTransaction.findUnique({
        where: { guildId_operationId: { guildId: actor.guildId, operationId } },
      });
      if (replay) {
        if (replay.type !== 'UPGRADE_PURCHASE' || replay.actorCharacterId !== characterId) {
          throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid');
        }
        return;
      }
      const guild = await tx.guild.findUnique({
        where: { id: actor.guildId },
        select: { treasurySilver: true, experienceUpgradeLevel: true, totalSilverSpentOnUpgrades: true },
      });
      if (!guild) {
        throw new GameError(GAME_ERROR_CODES.GUILD_REQUIRED, 'errors.guild.required');
      }
      const cost = guildExperienceUpgradeCost(guild.experienceUpgradeLevel);
      if (cost === null || guild.experienceUpgradeLevel >= GUILD_MAX_EXPERIENCE_UPGRADE_LEVEL) {
        throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid', {
          reason: 'GUILD_EXPERIENCE_UPGRADE_MAXED',
        });
      }
      if (guild.treasurySilver < cost) {
        throw new GameError(GAME_ERROR_CODES.INSUFFICIENT_SILVER, 'errors.items.insufficientSilver', {
          source: 'GUILD_TREASURY',
          balance: guild.treasurySilver,
          required: cost,
        });
      }
      if (guild.totalSilverSpentOnUpgrades > MAX_DATABASE_INT - cost) {
        throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid', {
          reason: 'GUILD_TREASURY_LIMIT',
        });
      }
      const nextLevel = guild.experienceUpgradeLevel + 1;
      const updatedGuild = await tx.guild.update({
        where: { id: actor.guildId },
        data: {
          treasurySilver: { decrement: cost },
          experienceUpgradeLevel: nextLevel,
          totalSilverSpentOnUpgrades: { increment: cost },
        },
        select: { treasurySilver: true },
      });
      await tx.guildTreasuryTransaction.create({
        data: {
          guildId: actor.guildId,
          operationId,
          actorCharacterId: characterId,
          actorName: actor.character.name,
          type: 'UPGRADE_PURCHASE',
          amount: cost,
          balanceAfter: updatedGuild.treasurySilver,
          upgradeLevel: nextLevel,
        },
      });
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
      select: { id: true, userId: true, realmId: true, name: true, silver: true },
    });
    if (!character) throw new GameError(GAME_ERROR_CODES.CHARACTER_NOT_FOUND, 'errors.character.required');
    return character;
  }

  private async member(userId: string, characterId: string): Promise<GuildActor> {
    await this.owner(userId, characterId);
    const membership = await this.prisma.guildMember.findUnique({
      where: { characterId },
      include: { character: { select: { realmId: true, name: true } } },
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
    const onlineMemberCount = members.filter((member) =>
      Boolean(this.world.getByCharacterId(member.character.id)?.activeInWorld),
    ).length;
    const totalMemberLevels = members.reduce((sum, member) => sum + member.character.level, 0);
    const memberCount = members.length;
    return {
      id: guild.id,
      name: guild.name,
      tag: guild.tag,
      description: guild.description,
      level: guild.level,
      experience: guild.experience,
      role,
      createdAt: guild.createdAt.getTime(),
      members: members.map((member) => ({
        characterId: member.character.id,
        name: member.character.name,
        level: member.character.level,
        role: member.role as GuildRoleValue,
        online: Boolean(this.world.getByCharacterId(member.character.id)?.activeInWorld),
        joinedAt: member.joinedAt.getTime(),
        contributedSilver: member.contributedSilver,
        mobKills: member.mobKills,
        bonusExperienceEarned: member.bonusExperienceEarned,
        lastContributionAt: member.lastContributionAt?.getTime() ?? null,
      })),
      treasury: {
        silver: guild.treasurySilver,
        experienceUpgradeLevel: guild.experienceUpgradeLevel,
        experienceBonusPercent: guildExperienceBonusPercent(guild.experienceUpgradeLevel),
        maximumUpgradeLevel: GUILD_MAX_EXPERIENCE_UPGRADE_LEVEL,
        nextUpgradeCost: guildExperienceUpgradeCost(guild.experienceUpgradeLevel),
        totalSilverDeposited: guild.totalSilverDeposited,
        totalSilverWithdrawn: guild.totalSilverWithdrawn,
        totalSilverSpentOnUpgrades: guild.totalSilverSpentOnUpgrades,
        recentTransactions: guild.treasuryTransactions.map((transaction) => ({
          id: transaction.id,
          type: transaction.type,
          amount: transaction.amount,
          balanceAfter: transaction.balanceAfter,
          actorCharacterId: transaction.actorCharacterId,
          actorName: transaction.actorName,
          upgradeLevel: transaction.upgradeLevel,
          createdAt: transaction.createdAt.getTime(),
        })),
      },
      statistics: {
        memberCount,
        onlineMemberCount,
        averageMemberLevel: memberCount === 0 ? 0 : Math.round((totalMemberLevels / memberCount) * 10) / 10,
        totalMemberLevels,
        mobKills: guild.mobKills,
        bonusExperienceGranted: guild.bonusExperienceGranted,
      },
    };
  }

  private async replayedTransaction(
    tx: Prisma.TransactionClient,
    guildId: string,
    operationId: string,
    type: TreasuryTransactionType,
    actorCharacterId: string,
    amount: number,
  ): Promise<boolean> {
    const existing = await tx.guildTreasuryTransaction.findUnique({
      where: { guildId_operationId: { guildId, operationId } },
    });
    if (!existing) return false;
    if (
      existing.type !== type ||
      existing.actorCharacterId !== actorCharacterId ||
      existing.amount !== amount
    ) {
      throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid');
    }
    return true;
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

  private async lockCharacter(tx: Prisma.TransactionClient, characterId: string): Promise<void> {
    const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      'SELECT "id" FROM "Character" WHERE "id" = $1::uuid FOR UPDATE',
      characterId,
    );
    if (rows.length === 0) {
      throw new GameError(GAME_ERROR_CODES.CHARACTER_NOT_FOUND, 'errors.character.required');
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
