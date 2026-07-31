import 'dotenv/config';
import { Pool } from 'pg';
import type { CharacterClass } from '../../src/common/domain/game.types.js';
import {
  calculateBaseStats,
  requireProgressionRuleset,
  type ProgressionStats,
} from '../../src/modules/characters/progression.rules.js';

interface CharacterRow extends ProgressionStats {
  id: string;
  class: CharacterClass;
  level: number;
  experience: number;
  hp: number;
  energy: number;
}

interface EquippedItemRow {
  characterId: string;
  metadata: unknown;
}

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL or DIRECT_URL is required.');
const maximumLevel = Number(process.env.MAX_CHARACTER_LEVEL ?? 100);
if (!Number.isInteger(maximumLevel) || maximumLevel < 1) {
  throw new Error('MAX_CHARACTER_LEVEL must be a positive integer.');
}
const ruleset = requireProgressionRuleset(process.env.PROGRESSION_RULESET_VERSION ?? 'v1');
const dryRun = process.argv.includes('--dry-run');
const statKeys = [
  'maxHp',
  'maxEnergy',
  'strength',
  'agility',
  'intelligence',
  'armor',
] as const;

const emptyBonuses = (): ProgressionStats => ({
  maxHp: 0,
  maxEnergy: 0,
  strength: 0,
  agility: 0,
  intelligence: 0,
  armor: 0,
});

const parseBonuses = (metadata: unknown): Partial<ProgressionStats> => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const statBonuses = (metadata as { statBonuses?: unknown }).statBonuses;
  if (!statBonuses || typeof statBonuses !== 'object' || Array.isArray(statBonuses)) return {};
  const parsed: Partial<ProgressionStats> = {};
  for (const key of statKeys) {
    const value = (statBonuses as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value)) parsed[key] = value;
  }
  return parsed;
};

const main = async (): Promise<void> => {
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('character-progression-migration'))`);
    const [characters, equippedItems] = await Promise.all([
      client.query<CharacterRow>(`
        SELECT id, class, level, experience, hp, "maxHp", energy, "maxEnergy",
               strength, agility, intelligence, armor
        FROM "Character"
        ORDER BY id
        FOR UPDATE
      `),
      client.query<EquippedItemRow>(`
        SELECT item."characterId", definition.metadata
        FROM "InventoryItem" item
        JOIN "ItemDefinition" definition ON definition.id = item."itemDefinitionId"
        WHERE item."equippedSlot" IS NOT NULL
        ORDER BY item."characterId", item.id
      `),
    ]);

    const bonusesByCharacter = new Map<string, ProgressionStats>();
    for (const item of equippedItems.rows) {
      const total = bonusesByCharacter.get(item.characterId) ?? emptyBonuses();
      const bonuses = parseBonuses(item.metadata);
      for (const key of statKeys) total[key] += bonuses[key] ?? 0;
      bonusesByCharacter.set(item.characterId, total);
    }

    let changed = 0;
    for (const character of characters.rows) {
      const level = Math.min(maximumLevel, Math.max(1, Math.trunc(character.level)));
      const base = calculateBaseStats(character.class, level, ruleset);
      const bonuses = bonusesByCharacter.get(character.id) ?? emptyBonuses();
      const stats = Object.fromEntries(
        statKeys.map((key) => [key, Math.max(0, Math.round(base[key] + bonuses[key]))]),
      ) as unknown as ProgressionStats;
      stats.maxHp = Math.max(1, stats.maxHp);
      const hpRatio = character.maxHp > 0 ? character.hp / character.maxHp : 1;
      const energyRatio = character.maxEnergy > 0 ? character.energy / character.maxEnergy : 1;
      const next = {
        level,
        experience: level >= maximumLevel ? 0 : Math.max(0, character.experience),
        hp: Math.max(0, Math.min(stats.maxHp, Math.round(stats.maxHp * hpRatio))),
        energy: Math.max(
          0,
          Math.min(stats.maxEnergy, Math.round(stats.maxEnergy * energyRatio)),
        ),
      };
      const requiresUpdate =
        character.level !== next.level ||
        character.experience !== next.experience ||
        character.hp !== next.hp ||
        character.energy !== next.energy ||
        statKeys.some((key) => character[key] !== stats[key]);
      if (!requiresUpdate) continue;
      changed += 1;
      await client.query(
        `
          UPDATE "Character"
          SET level = $2,
              experience = $3,
              hp = $4,
              "maxHp" = $5,
              energy = $6,
              "maxEnergy" = $7,
              strength = $8,
              agility = $9,
              intelligence = $10,
              armor = $11,
              "stateVersion" = "stateVersion" + 1,
              "lastSavedAt" = now(),
              "updatedAt" = now()
          WHERE id = $1
        `,
        [
          character.id,
          next.level,
          next.experience,
          next.hp,
          stats.maxHp,
          next.energy,
          stats.maxEnergy,
          stats.strength,
          stats.agility,
          stats.intelligence,
          stats.armor,
        ],
      );
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log(`Dry run: ${changed} character(s) would be migrated to ${ruleset.version}.`);
    } else {
      await client.query('COMMIT');
      console.log(`Migrated ${changed} character(s) to ${ruleset.version}.`);
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
