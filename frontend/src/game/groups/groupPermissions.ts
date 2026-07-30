import type { GroupDetailsPayload } from '../../contracts/group';

export function canInviteToGroup(
  group: GroupDetailsPayload | null,
  actorCharacterId: string | undefined,
  targetCharacterId: string,
): boolean {
  if (!actorCharacterId || actorCharacterId === targetCharacterId) return false;
  if (!group) return true;
  return (
    group.adminCharacterId === actorCharacterId &&
    !group.members.some((member) => member.characterId === targetCharacterId)
  );
}

export function canKickGroupMember(
  group: GroupDetailsPayload | null,
  actorCharacterId: string | undefined,
  targetCharacterId: string,
): boolean {
  if (!group || !actorCharacterId || actorCharacterId === targetCharacterId) return false;
  return (
    group.adminCharacterId === actorCharacterId &&
    group.members.some((member) => member.characterId === targetCharacterId && !member.admin)
  );
}
