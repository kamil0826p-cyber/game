import { describe, expect, it, vi } from 'vitest';
import { GuildPermissionService } from '../src/modules/guilds/guild-permission.service.js';
import type { PrismaService } from '../src/database/prisma.service.js';

function service(overrides: Array<{ permission: string; allowed: boolean }> = []) {
  const prisma = {
    guildRolePermission: {
      findMany: vi.fn().mockResolvedValue(overrides),
      upsert: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;
  return { permissions: new GuildPermissionService(prisma), prisma };
}

describe('guild granular permissions', () => {
  it('uses safe role defaults and never strips leader permissions', async () => {
    const { permissions } = service([{ permission: 'DISBAND', allowed: false }]);
    await expect(permissions.permissionsForRole('guild', 'LEADER')).resolves.toContain('DISBAND');
    await expect(permissions.permissionsForRole('guild', 'MEMBER')).resolves.toEqual(['BANK_DEPOSIT']);
  });

  it('allows explicit grants and revocations for officer and member roles', async () => {
    const { permissions } = service([
      { permission: 'INVITE', allowed: true },
      { permission: 'BANK_DEPOSIT', allowed: false },
    ]);
    const result = await permissions.permissionsForRole('guild', 'MEMBER');
    expect(result).toContain('INVITE');
    expect(result).not.toContain('BANK_DEPOSIT');
  });

  it('rejects permission mutation by non-leaders and protects the leader role', async () => {
    const { permissions, prisma } = service();
    await expect(permissions.setOverride(
      { guildId: 'guild', characterId: 'member', role: 'MEMBER' },
      'MEMBER',
      'INVITE',
      true,
    )).rejects.toThrow('GUILD_FORBIDDEN');
    await expect(permissions.setOverride(
      { guildId: 'guild', characterId: 'leader', role: 'LEADER' },
      'LEADER',
      'DISBAND',
      false,
    )).rejects.toThrow('GUILD_FORBIDDEN');
    expect((prisma.guildRolePermission as { upsert: ReturnType<typeof vi.fn> }).upsert).not.toHaveBeenCalled();
  });
});
