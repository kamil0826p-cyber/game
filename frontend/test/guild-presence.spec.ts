import { describe, expect, it } from 'vitest';
import type { GuildSnapshot } from '../src/contracts/guild';
import {
  clearGuildPresence,
  isGuildMate,
  setGuildPresence,
} from '../src/game/guilds/guildPresence';

const snapshot: GuildSnapshot = {
  guild: {
    id: 'guild-a',
    name: 'Strażnicy',
    tag: 'STR',
    description: '',
    level: 1,
    experience: 0,
    role: 'MEMBER',
    members: [
      {
        characterId: 'self',
        name: 'Self',
        level: 5,
        role: 'MEMBER',
        online: true,
        joinedAt: 1,
      },
      {
        characterId: 'ally',
        name: 'Ally',
        level: 6,
        role: 'OFFICER',
        online: true,
        joinedAt: 2,
      },
    ],
  },
  invites: [],
};

describe('guild presence', () => {
  it('marks only members from the current guild as guildmates', () => {
    setGuildPresence(snapshot);
    expect(isGuildMate('ally')).toBe(true);
    expect(isGuildMate('stranger')).toBe(false);

    clearGuildPresence();
    expect(isGuildMate('ally')).toBe(false);
  });
});
