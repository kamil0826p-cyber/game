import { describe, expect, it } from 'vitest';
import {
  GROUP_INVITE_TTL_MS,
  GROUP_MAX_MEMBERS,
  canAddGroupMember,
  isGroupFull,
} from '../src/modules/groups/group.rules.js';

describe('group rules', () => {
  it('caps a group at ten members', () => {
    expect(GROUP_MAX_MEMBERS).toBe(10);
    expect(isGroupFull(9)).toBe(false);
    expect(isGroupFull(10)).toBe(true);
    expect(canAddGroupMember(9)).toBe(true);
    expect(canAddGroupMember(10)).toBe(false);
  });

  it('keeps invitations short lived', () => {
    expect(GROUP_INVITE_TTL_MS).toBe(60_000);
  });
});
