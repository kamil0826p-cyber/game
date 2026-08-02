import { describe, expect, it } from 'vitest';
import {
  GUILD_EXPERIENCE_UPGRADE_COSTS,
  GUILD_INVITE_TTL_MS,
  GUILD_MAX_EXPERIENCE_UPGRADE_LEVEL,
  GUILD_MAX_MEMBERS,
  calculateGuildExperienceReward,
  canEditDescription,
  canInvite,
  canKick,
  canManageGuildTreasury,
  canSetRole,
  guildExperienceBonusPercent,
  guildExperienceUpgradeCost,
  isGuildNameValid,
  isGuildTagValid,
  isGuildTreasuryAmountValid,
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

  it('allows only the leader to promote, withdraw and buy upgrades', () => {
    expect(canSetRole('LEADER', 'MEMBER', 'OFFICER')).toBe(true);
    expect(canSetRole('LEADER', 'OFFICER', 'MEMBER')).toBe(true);
    expect(canSetRole('OFFICER', 'MEMBER', 'OFFICER')).toBe(false);
    expect(canSetRole('LEADER', 'LEADER', 'MEMBER')).toBe(false);
    expect(canSetRole('LEADER', 'MEMBER', 'MEMBER')).toBe(false);
    expect(canManageGuildTreasury('LEADER')).toBe(true);
    expect(canManageGuildTreasury('OFFICER')).toBe(false);
    expect(canManageGuildTreasury('MEMBER')).toBe(false);
  });

  it('uses ten increasingly expensive experience upgrades', () => {
    expect(GUILD_MAX_EXPERIENCE_UPGRADE_LEVEL).toBe(10);
    expect(GUILD_EXPERIENCE_UPGRADE_COSTS).toHaveLength(10);
    expect(guildExperienceUpgradeCost(0)).toBe(25_000);
    expect(guildExperienceUpgradeCost(9)).toBe(2_500_000);
    expect(guildExperienceUpgradeCost(10)).toBeNull();
    expect(GUILD_EXPERIENCE_UPGRADE_COSTS.every((cost, index, all) => index === 0 || cost > all[index - 1]!)).toBe(true);
  });

  it('adds two percent mob experience per upgrade and caps at twenty percent', () => {
    expect(guildExperienceBonusPercent(0)).toBe(0);
    expect(guildExperienceBonusPercent(4)).toBe(8);
    expect(guildExperienceBonusPercent(10)).toBe(20);
    expect(guildExperienceBonusPercent(99)).toBe(20);
    expect(calculateGuildExperienceReward(101, 3)).toEqual({
      baseExperience: 101,
      bonusExperience: 6,
      totalExperience: 107,
      bonusPercent: 6,
    });
    expect(calculateGuildExperienceReward(100, 10).totalExperience).toBe(120);
  });

  it('accepts only positive safe treasury operations within the database limit', () => {
    expect(isGuildTreasuryAmountValid(1)).toBe(true);
    expect(isGuildTreasuryAmountValid(2_000_000_000)).toBe(true);
    expect(isGuildTreasuryAmountValid(0)).toBe(false);
    expect(isGuildTreasuryAmountValid(1.5)).toBe(false);
    expect(isGuildTreasuryAmountValid(2_000_000_001)).toBe(false);
  });
});
