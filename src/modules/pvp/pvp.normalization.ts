import type { PvpNormalizationPreview, PvpPowerStats, PvpReplayEnvelope, PvpSeasonDefinition } from './pvp.types.js';
import { PVP_RULES_VERSION } from './pvp.constants.js';

function clampStat(value: number): number {
  return Math.max(1, Math.round(value));
}

function sumStats(stats: PvpPowerStats): number {
  return (
    stats.maxHp * 0.12 +
    stats.maxEnergy * 0.2 +
    stats.strength +
    stats.agility +
    stats.intelligence +
    stats.armor * 1.2 +
    stats.magicResistance * 1.2
  );
}

export function previewPvpNormalization(
  characterId: string,
  level: number,
  stats: PvpPowerStats,
  bracketLevel = 50,
): PvpNormalizationPreview {
  const powerBudget = 500 + bracketLevel * 12;
  const originalPower = Math.max(1, sumStats(stats));
  const rawScale = powerBudget / originalPower;
  const scale = Math.min(1.75, Math.max(0.55, rawScale));
  const normalized: PvpPowerStats = {
    maxHp: clampStat(stats.maxHp * scale),
    maxEnergy: clampStat(stats.maxEnergy * Math.min(1.25, Math.max(0.8, scale))),
    strength: clampStat(stats.strength * scale),
    agility: clampStat(stats.agility * scale),
    intelligence: clampStat(stats.intelligence * scale),
    armor: clampStat(stats.armor * scale),
    magicResistance: clampStat(stats.magicResistance * scale),
  };
  const offense = stats.strength + stats.agility + stats.intelligence;
  const defense = stats.maxHp * 0.1 + stats.armor + stats.magicResistance;
  const utility = stats.maxEnergy + stats.agility;
  const totalIdentity = Math.max(1, offense + defense + utility);
  return {
    characterId,
    bracketLevel: Math.max(bracketLevel, level > bracketLevel ? bracketLevel : level),
    powerBudget,
    original: { ...stats },
    normalized,
    retainedIdentityRatios: {
      offense: offense / totalIdentity,
      defense: defense / totalIdentity,
      utility: utility / totalIdentity,
    },
  };
}

export function validatePvpSeason(season: PvpSeasonDefinition): void {
  if (!season.key.trim()) throw new Error('PVP_SEASON_KEY_REQUIRED');
  if (!Number.isInteger(season.version) || season.version < 1) {
    throw new Error('PVP_SEASON_VERSION_INVALID');
  }
  if (season.startsAt >= season.endsAt) throw new Error('PVP_SEASON_WINDOW_INVALID');
  if (season.modeKeys.length === 0) throw new Error('PVP_SEASON_MODES_REQUIRED');
  if (season.minimumLeaderboardMatches < 1) {
    throw new Error('PVP_SEASON_LEADERBOARD_THRESHOLD_INVALID');
  }
  if (season.rewardKeys.some((key) => /power|damage|stat|level/i.test(key))) {
    throw new Error('PVP_SEASON_POWER_REWARD_FORBIDDEN');
  }
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(',')}}`;
}

export function pvpReplayChecksum(replay: PvpReplayEnvelope): string {
  const input = stableSerialize(replay);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `pvp-${PVP_RULES_VERSION}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
