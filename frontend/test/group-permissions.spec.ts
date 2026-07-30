import { describe, expect, it } from 'vitest';
import type { GroupDetailsPayload } from '../src/contracts/group';
import {
  canInviteToGroup,
  canKickGroupMember,
} from '../src/game/groups/groupPermissions';

const group: GroupDetailsPayload = {
  id: 'group-a',
  adminCharacterId: 'admin',
  maxMembers: 10,
  members: [
    {
      characterId: 'admin',
      name: 'Admin',
      characterClass: 'WARRIOR',
      level: 10,
      outfitKey: 'warrior-default',
      hp: 100,
      maxHp: 100,
      online: true,
      admin: true,
    },
    {
      characterId: 'member',
      name: 'Member',
      characterClass: 'MAGE',
      level: 8,
      outfitKey: 'mage-default',
      hp: 80,
      maxHp: 90,
      online: true,
      admin: false,
    },
  ],
};

describe('group administrator UI permissions', () => {
  it('allows a solo player or current administrator to invite', () => {
    expect(canInviteToGroup(null, 'solo', 'target')).toBe(true);
    expect(canInviteToGroup(group, 'admin', 'target')).toBe(true);
  });

  it('hides invitations from regular members and existing group members', () => {
    expect(canInviteToGroup(group, 'member', 'target')).toBe(false);
    expect(canInviteToGroup(group, 'admin', 'member')).toBe(false);
  });

  it('allows only the administrator to remove another non-admin member', () => {
    expect(canKickGroupMember(group, 'admin', 'member')).toBe(true);
    expect(canKickGroupMember(group, 'member', 'admin')).toBe(false);
    expect(canKickGroupMember(group, 'admin', 'admin')).toBe(false);
    expect(canKickGroupMember(group, 'admin', 'missing')).toBe(false);
  });
});
