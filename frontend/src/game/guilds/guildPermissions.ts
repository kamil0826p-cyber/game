import type { GuildRole } from '../../contracts/guild';

export function canGuildInvite(role: GuildRole): boolean {
  return role === 'LEADER' || role === 'OFFICER';
}

export function canGuildEditDescription(role: GuildRole): boolean {
  return role === 'LEADER' || role === 'OFFICER';
}

export function canGuildKick(actor: GuildRole, target: GuildRole): boolean {
  if (target === 'LEADER') return false;
  if (actor === 'LEADER') return true;
  return actor === 'OFFICER' && target === 'MEMBER';
}

export function canGuildSetRole(
  actor: GuildRole,
  target: GuildRole,
  nextRole: Exclude<GuildRole, 'LEADER'>,
): boolean {
  return actor === 'LEADER' && target !== 'LEADER' && target !== nextRole;
}
