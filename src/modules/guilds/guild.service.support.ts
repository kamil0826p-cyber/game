import { Logger } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { GuildSnapshot } from '../../contracts/guild.events.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { WorldEventsPublisher } from '../world/world-events.publisher.js';
import { WorldStateService } from '../world/world-state.service.js';
import { GuildPermissionService } from './guild-permission.service.js';
import type { GuildRoleValue } from './guild.rules.js';

const guildInclude = {
  members: {
    include: { character: { select: { id: true, name: true, level: true } } },
    orderBy: { joinedAt: 'asc' as const },
  },
};
type GuildWithMembers = Prisma.GuildGetPayload<{ include: typeof guildInclude }>;
type OwnedCharacter = { id: string; userId: string; realmId: string; name: string };
type GuildActor = Prisma.GuildMemberGetPayload<{
  include: { character: { select: { realmId: true } } };
}>;
const roleOrder: Record<GuildRoleValue, number> = { LEADER: 0, OFFICER: 1, MEMBER: 2 };

export abstract class GuildServiceSupport {
  protected readonly logger = new Logger('GuildService');

  protected constructor(
    protected readonly prisma: PrismaService,
    protected readonly world: WorldStateService,
    protected readonly publisher: WorldEventsPublisher,
    protected readonly permissions: GuildPermissionService,
  ) {}

  protected async owner(userId: string, characterId: string): Promise<OwnedCharacter> {
    const character = await this.prisma.character.findFirst({
      where: { id: characterId, userId },
      select: { id: true, userId: true, realmId: true, name: true },
    });
    if (!character) {
      throw new GameError(GAME_ERROR_CODES.CHARACTER_NOT_FOUND, 'errors.character.required');
    }
    return character;
  }

  protected async member(userId: string, characterId: string): Promise<GuildActor> {
    await this.owner(userId, characterId);
    const membership = await this.prisma.guildMember.findUnique({
      where: { characterId },
      include: { character: { select: { realmId: true } } },
    });
    if (!membership) {
      throw new GameError(GAME_ERROR_CODES.GUILD_REQUIRED, 'errors.guild.required');
    }
    return membership;
  }

  protected async txMember(
    tx: Prisma.TransactionClient,
    characterId: string,
    guildId: string,
  ) {
    const membership = await tx.guildMember.findUnique({ where: { characterId } });
    if (!membership || membership.guildId !== guildId) {
      throw new GameError(GAME_ERROR_CODES.GUILD_MEMBER_NOT_FOUND, 'errors.guild.memberNotFound');
    }
    return membership;
  }

  protected guildPayload(
    guild: GuildWithMembers,
    role: GuildRoleValue,
  ): NonNullable<GuildSnapshot['guild']> {
    const members = [...guild.members].sort(
      (left, right) =>
        roleOrder[left.role as GuildRoleValue] - roleOrder[right.role as GuildRoleValue] ||
        left.joinedAt.getTime() - right.joinedAt.getTime(),
    );
    return {
      id: guild.id,
      name: guild.name,
      tag: guild.tag,
      description: guild.description,
      level: guild.level,
      experience: guild.experience,
      role,
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

  protected async expireInvites(characterId: string): Promise<void> {
    await this.prisma.guildInvite.updateMany({
      where: {
        targetCharacterId: characterId,
        status: 'PENDING',
        expiresAt: { lte: new Date() },
      },
      data: { status: 'EXPIRED', respondedAt: new Date() },
    });
  }

  protected async memberIds(guildId: string): Promise<string[]> {
    return (
      await this.prisma.guildMember.findMany({
        where: { guildId },
        select: { characterId: true },
      })
    ).map((member) => member.characterId);
  }

  protected async lockRealm(tx: Prisma.TransactionClient, realmId: string): Promise<void> {
    await tx.$queryRawUnsafe(
      'SELECT "id" FROM "Realm" WHERE "id" = $1::uuid FOR UPDATE',
      realmId,
    );
  }

  protected async lockGuild(tx: Prisma.TransactionClient, guildId: string): Promise<void> {
    const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      'SELECT "id" FROM "Guild" WHERE "id" = $1::uuid FOR UPDATE',
      guildId,
    );
    if (rows.length === 0) {
      throw new GameError(GAME_ERROR_CODES.GUILD_REQUIRED, 'errors.guild.required');
    }
  }

  protected async broadcastGuild(guildId: string, extraCharacterIds: string[] = []): Promise<void> {
    await this.broadcastCharacters([...(await this.memberIds(guildId)), ...extraCharacterIds]);
  }

  protected async broadcastCharacters(characterIds: string[]): Promise<void> {
    await Promise.all(
      [...new Set(characterIds)].map(async (characterId) => {
        const session = this.world.getByCharacterId(characterId);
        if (!session?.activeInWorld) return;
        try {
          this.publisher.emit(
            session.socketId,
            'guild:updated',
            await this.getSnapshotForBroadcast(session.userId, characterId),
          );
        } catch (error) {
          this.logger.warn(
            `Could not publish guild snapshot for character ${characterId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }),
    );
  }

  protected abstract getSnapshotForBroadcast(
    userId: string,
    characterId: string,
  ): Promise<GuildSnapshot>;
}
