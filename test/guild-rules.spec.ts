import { describe, expect, it } from 'vitest';
import {
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
} from '../src/modules/guilds/guild.rules.js';

describe('guild rules', () => {
  it('normalizes player-provided guild fields', () => {
    expect(normalizeGuildName('  Straż   Północy  ')).toBe('Straż Północy');
    expect(normalizeGuildTag(' s p ')).toBe('SP');
    expect(normalizeGuildDescription('  Wspólna   wyprawa  ')).toBe('Wspólna wyprawa');
  });

  it('validates names and tags', () => {
    expect(isGuildNameValid('Straż Północy')).toBe(true);
    expect(isGuildNameValid('x')).toBe(false);
    expect(isGuildTagValid('SP')).toBe(true);
    expect(isGuildTagValid('S!')).toBe(false);
  });

  it('uses stable membership and invitation limits', () => {
    expect(GUILD_MAX_MEMBERS).toBe(60);
    expect(GUILD_INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1_000);
  });

  it('allows leaders and officers to recruit and edit the description', () => {
    expect(canInvite('LEADER')).toBe(true);
    expect(canInvite('OFFICER')).toBe(true);
    expect(canInvite('MEMBER')).toBe(false);
    expect(canEditDescription('OFFICER')).toBe(true);
  });

  it('enforces the role hierarchy for kicks', () => {
    expect(canKick('LEADER', 'OFFICER')).toBe(true);
    expect(canKick('OFFICER', 'MEMBER')).toBe(true);
    expect(canKick('OFFICER', 'OFFICER')).toBe(false);
    expect(canKick('LEADER', 'LEADER')).toBe(false);
  });

  it('allows only the leader to promote or demote non-leaders', () => {
    expect(canSetRole('LEADER', 'MEMBER', 'OFFICER')).toBe(true);
    expect(canSetRole('LEADER', 'OFFICER', 'MEMBER')).toBe(true);
    expect(canSetRole('OFFICER', 'MEMBER', 'OFFICER')).toBe(false);
    expect(canSetRole('LEADER', 'LEADER', 'MEMBER')).toBe(false);
    expect(canSetRole('LEADER', 'MEMBER', 'MEMBER')).toBe(false);
  });
});
