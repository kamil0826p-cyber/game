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
    createdAt: 1,
    treasury: {
      silver: 0,
      experienceUpgradeLevel: 0,
      experienceBonusPercent: 0,
      maximumUpgradeLevel: 10,
      nextUpgradeCost: 25_000,
      totalSilverDeposited: 0,
      totalSilverWithdrawn: 0,
      totalSilverSpentOnUpgrades: 0,
      recentTransactions: [],
    },
    statistics: {
      memberCount: 2,
      onlineMemberCount: 2,
      averageMemberLevel: 5.5,
      totalMemberLevels: 11,
      mobKills: 0,
      bonusExperienceGranted: 0,
    },
    members: [
      {
        characterId: 'self',
        name: 'Self',
        level: 5,
        role: 'MEMBER',
        online: true,
        joinedAt: 1,
        contributedSilver: 0,
        mobKills: 0,
        bonusExperienceEarned: 0,
        lastContributionAt: null,
      },
      {
        characterId: 'ally',
        name: 'Ally',
        level: 6,
        role: 'OFFICER',
        online: true,
        joinedAt: 2,
        contributedSilver: 0,
        mobKills: 0,
        bonusExperienceEarned: 0,
        lastContributionAt: null,
      },
    ],
  },
  invites: [],
  characterSilver: 0,
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
