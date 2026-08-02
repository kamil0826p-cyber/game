import { Injectable } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { GuildRole, Prisma } from '../../generated/prisma/client.js';
import type { GuildSocialPermission } from '../social/social.types.js';

const ALL_PERMISSIONS: readonly GuildSocialPermission[] = [
  'INVITE', 'KICK', 'ROLE', 'DESCRIPTION', 'DISBAND',
  'BANK_DEPOSIT', 'BANK_WITHDRAW', 'BANK_AUDIT',
  'CONTRACT_MANAGE', 'PROJECT_MANAGE', 'ANNOUNCEMENT_MANAGE', 'EVENT_MANAGE',
];

const DEFAULTS: Record<GuildRole, ReadonlySet<GuildSocialPermission>> = {
  LEADER: new Set(ALL_PERMISSIONS),
  OFFICER: new Set([
    'INVITE', 'KICK', 'DESCRIPTION', 'BANK_DEPOSIT', 'BANK_WITHDRAW', 'BANK_AUDIT',
    'CONTRACT_MANAGE', 'PROJECT_MANAGE', 'ANNOUNCEMENT_MANAGE', 'EVENT_MANAGE',
  ]),
  MEMBER: new Set(['BANK_DEPOSIT']),
};

export interface GuildPermissionActor {
  guildId: string;
  characterId: string;
  role: GuildRole;
}

@Injectable()
export class GuildPermissionService {
  constructor(private readonly prisma: PrismaService) {}

  async actor(userId: string, characterId: string): Promise<GuildPermissionActor> {
    const member = await this.prisma.guildMember.findUnique({
      where: { characterId },
      include: { character: { select: { userId: true } } },
    });
    if (!member || member.character.userId !== userId) {
      throw new GameError(GAME_ERROR_CODES.GUILD_REQUIRED, 'errors.guild.required');
    }
    return { guildId: member.guildId, characterId, role: member.role };
  }

  async permissions(actor: GuildPermissionActor): Promise<GuildSocialPermission[]> {
    return this.permissionsForRole(actor.guildId, actor.role);
  }

  async permissionsForRole(
    guildId: string,
    role: GuildRole,
    transaction?: Prisma.TransactionClient,
  ): Promise<GuildSocialPermission[]> {
    const client = transaction ?? this.prisma;
    const overrides = await client.guildRolePermission.findMany({
      where: { guildId, role },
    });
    const allowed = new Set(DEFAULTS[role]);
    for (const override of overrides) {
      if (!ALL_PERMISSIONS.includes(override.permission as GuildSocialPermission)) continue;
      if (override.allowed) allowed.add(override.permission as GuildSocialPermission);
      else allowed.delete(override.permission as GuildSocialPermission);
    }
    if (role === 'LEADER') {
      for (const permission of ALL_PERMISSIONS) allowed.add(permission);
    }
    return [...allowed];
  }

  async require(actor: GuildPermissionActor, permission: GuildSocialPermission): Promise<void> {
    await this.requireForRole(actor.guildId, actor.role, permission);
  }

  async requireForRole(
    guildId: string,
    role: GuildRole,
    permission: GuildSocialPermission,
    transaction?: Prisma.TransactionClient,
  ): Promise<void> {
    if (!(await this.permissionsForRole(guildId, role, transaction)).includes(permission)) {
      throw new GameError(GAME_ERROR_CODES.GUILD_FORBIDDEN, 'errors.guild.forbidden', {
        permission,
      });
    }
  }

  async setOverride(
    actor: GuildPermissionActor,
    role: GuildRole,
    permission: GuildSocialPermission,
    allowed: boolean,
    transaction?: Prisma.TransactionClient,
  ): Promise<void> {
    if (actor.role !== 'LEADER' || role === 'LEADER') {
      throw new GameError(GAME_ERROR_CODES.GUILD_FORBIDDEN, 'errors.guild.forbidden');
    }
    const client = transaction ?? this.prisma;
    await client.guildRolePermission.upsert({
      where: {
        guildId_role_permission: { guildId: actor.guildId, role, permission },
      },
      create: {
        guildId: actor.guildId,
        role,
        permission,
        allowed,
        updatedBy: actor.characterId,
      },
      update: { allowed, updatedBy: actor.characterId },
    });
  }
}
