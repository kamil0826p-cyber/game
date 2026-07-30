import { describe, expect, it } from 'vitest';
import {
  canGuildEditDescription,
  canGuildInvite,
  canGuildKick,
  canGuildSetRole,
} from '../src/game/guilds/guildPermissions';

describe('guild UI permissions', () => {
  it('matches recruitment and description permissions', () => {
    expect(canGuildInvite('LEADER')).toBe(true);
    expect(canGuildInvite('OFFICER')).toBe(true);
    expect(canGuildInvite('MEMBER')).toBe(false);
    expect(canGuildEditDescription('MEMBER')).toBe(false);
  });

  it('does not offer actions forbidden by the server hierarchy', () => {
    expect(canGuildKick('OFFICER', 'MEMBER')).toBe(true);
    expect(canGuildKick('OFFICER', 'OFFICER')).toBe(false);
    expect(canGuildKick('LEADER', 'LEADER')).toBe(false);
    expect(canGuildSetRole('LEADER', 'MEMBER', 'OFFICER')).toBe(true);
    expect(canGuildSetRole('OFFICER', 'MEMBER', 'OFFICER')).toBe(false);
  });
});
