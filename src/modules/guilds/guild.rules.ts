export type GuildRoleValue = 'LEADER' | 'OFFICER' | 'MEMBER';

export const GUILD_NAME_MIN_LENGTH = 3;
export const GUILD_NAME_MAX_LENGTH = 32;
export const GUILD_TAG_MIN_LENGTH = 2;
export const GUILD_TAG_MAX_LENGTH = 5;
export const GUILD_DESCRIPTION_MAX_LENGTH = 280;
export const GUILD_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const GUILD_MAX_MEMBERS = 60;
export const GUILD_MAX_EXPERIENCE_UPGRADE_LEVEL = 10;
export const GUILD_EXPERIENCE_BONUS_PER_LEVEL_PERCENT = 2;
export const GUILD_TREASURY_MAX_OPERATION = 2_000_000_000;

export const GUILD_EXPERIENCE_UPGRADE_COSTS = [
  25_000,
  60_000,
  125_000,
  225_000,
  375_000,
  600_000,
  900_000,
  1_300_000,
  1_800_000,
  2_500_000,
] as const;

const SPACE_PATTERN = /\s+/gu;
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} .'-]*$/u;
const TAG_PATTERN = /^[A-Z0-9]+$/;

export function normalizeGuildName(value: string): string {
  return value.normalize('NFKC').replace(SPACE_PATTERN, ' ').trim();
}

export function normalizeGuildTag(value: string): string {
  return value.normalize('NFKC').replace(SPACE_PATTERN, '').trim().toUpperCase();
}

export function normalizeGuildDescription(value: string): string {
  return value.normalize('NFKC').replace(SPACE_PATTERN, ' ').trim();
}

export function isGuildNameValid(value: string): boolean {
  const normalized = normalizeGuildName(value);
  return (
    normalized.length >= GUILD_NAME_MIN_LENGTH &&
    normalized.length <= GUILD_NAME_MAX_LENGTH &&
    NAME_PATTERN.test(normalized)
  );
}

export function isGuildTagValid(value: string): boolean {
  const normalized = normalizeGuildTag(value);
  return (
    normalized.length >= GUILD_TAG_MIN_LENGTH &&
    normalized.length <= GUILD_TAG_MAX_LENGTH &&
    TAG_PATTERN.test(normalized)
  );
}

export function canInvite(role: GuildRoleValue): boolean {
  return role === 'LEADER' || role === 'OFFICER';
}

export function canEditDescription(role: GuildRoleValue): boolean {
  return role === 'LEADER' || role === 'OFFICER';
}

export function canManageGuildTreasury(role: GuildRoleValue): boolean {
  return role === 'LEADER';
}

export function canKick(actorRole: GuildRoleValue, targetRole: GuildRoleValue): boolean {
  if (targetRole === 'LEADER') return false;
  if (actorRole === 'LEADER') return true;
  return actorRole === 'OFFICER' && targetRole === 'MEMBER';
}

export function canSetRole(
  actorRole: GuildRoleValue,
  targetRole: GuildRoleValue,
  nextRole: Exclude<GuildRoleValue, 'LEADER'>,
): boolean {
  if (actorRole !== 'LEADER' || targetRole === 'LEADER') return false;
  return targetRole !== nextRole;
}

export function isGuildTreasuryAmountValid(amount: number): boolean {
  return Number.isSafeInteger(amount) && amount >= 1 && amount <= GUILD_TREASURY_MAX_OPERATION;
}

export function guildExperienceUpgradeCost(currentLevel: number): number | null {
  if (!Number.isInteger(currentLevel) || currentLevel < 0) return null;
  return GUILD_EXPERIENCE_UPGRADE_COSTS[currentLevel] ?? null;
}

export function guildExperienceBonusPercent(upgradeLevel: number): number {
  const level = Math.min(
    GUILD_MAX_EXPERIENCE_UPGRADE_LEVEL,
    Math.max(0, Math.trunc(upgradeLevel)),
  );
  return level * GUILD_EXPERIENCE_BONUS_PER_LEVEL_PERCENT;
}

export interface GuildExperienceReward {
  baseExperience: number;
  bonusExperience: number;
  totalExperience: number;
  bonusPercent: number;
}

export function calculateGuildExperienceReward(
  baseExperience: number,
  upgradeLevel: number,
): GuildExperienceReward {
  const base = Math.max(0, Math.trunc(baseExperience));
  const bonusPercent = guildExperienceBonusPercent(upgradeLevel);
  const bonusExperience = Math.floor((base * bonusPercent) / 100);
  return {
    baseExperience: base,
    bonusExperience,
    totalExperience: base + bonusExperience,
    bonusPercent,
  };
}
