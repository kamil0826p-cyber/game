export const GROUP_MAX_MEMBERS = 10;
export const GROUP_INVITE_TTL_MS = 60_000;

export function isGroupFull(memberCount: number): boolean {
  return memberCount >= GROUP_MAX_MEMBERS;
}

export function canAddGroupMember(memberCount: number): boolean {
  return memberCount >= 1 && !isGroupFull(memberCount);
}
