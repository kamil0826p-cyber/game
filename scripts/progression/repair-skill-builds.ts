import 'dotenv/config';
import { Pool } from 'pg';
import type { CharacterClass } from '../../src/common/domain/game.types.js';
import {
  calculateSkillPointBudget,
  requireProgressionRuleset,
} from '../../src/modules/characters/progression.rules.js';
import { repairSkillBuild } from '../../src/modules/skills/skill-build.rules.js';
import { SKILL_CATALOG, skillsForClass } from '../../src/modules/skills/skill.catalog.js';

interface CharacterRow {
  id: string;
  class: CharacterClass;
  level: number;
}

interface CharacterSkillRow {
  id: string;
  characterId: string;
  key: string;
  rank: number;
}

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL or DIRECT_URL is required.');
const ruleset = requireProgressionRuleset(process.env.PROGRESSION_RULESET_VERSION ?? 'v1');
const dryRun = process.argv.includes('--dry-run');

const main = async (): Promise<void> => {
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('skill-build-repair'))`);
    const [characters, skills] = await Promise.all([
      client.query<CharacterRow>(`
        SELECT id, class, level
        FROM "Character"
        ORDER BY id
        FOR UPDATE
      `),
      client.query<CharacterSkillRow>(`
        SELECT owned.id, owned."characterId", definition.key, owned.rank
        FROM "CharacterSkill" owned
        JOIN "SkillDefinition" definition ON definition.id = owned."skillDefinitionId"
        ORDER BY owned."characterId", definition.key
      `),
    ]);

    const skillsByCharacter = new Map<string, CharacterSkillRow[]>();
    for (const skill of skills.rows) {
      const owned = skillsByCharacter.get(skill.characterId) ?? [];
      owned.push(skill);
      skillsByCharacter.set(skill.characterId, owned);
    }

    let changedCharacters = 0;
    let removedSkills = 0;
    let adjustedRanks = 0;
    for (const character of characters.rows) {
      const owned = skillsByCharacter.get(character.id) ?? [];
      const capacity = skillsForClass(character.class).reduce(
        (sum, definition) => sum + definition.maxRank,
        0,
      );
      const pointBudget = calculateSkillPointBudget(
        character.level,
        0,
        capacity,
        ruleset,
      ).earned;
      const repair = repairSkillBuild(
        character.class,
        character.level,
        pointBudget,
        SKILL_CATALOG,
        owned.map((skill) => ({ key: skill.key, rank: skill.rank })),
      );
      const removedKeys = new Set(repair.removed.map((skill) => skill.key));
      const rankByKey = new Map(repair.kept.map((skill) => [skill.key, skill]));
      const removals = owned.filter((skill) => removedKeys.has(skill.key));
      const adjustments = owned.filter((skill) => {
        const repaired = rankByKey.get(skill.key);
        return repaired && repaired.rank !== skill.rank;
      });
      if (removals.length === 0 && adjustments.length === 0) continue;
      changedCharacters += 1;
      removedSkills += removals.length;
      adjustedRanks += adjustments.length;

      if (removals.length > 0) {
        await client.query(
          `DELETE FROM "CharacterSkill" WHERE id = ANY($1::uuid[])`,
          [removals.map((skill) => skill.id)],
        );
      }
      for (const skill of adjustments) {
        const repaired = rankByKey.get(skill.key)!;
        await client.query(
          `UPDATE "CharacterSkill"
           SET rank = $2, "cooldownTurnsRemaining" = 0, "updatedAt" = now()
           WHERE id = $1`,
          [skill.id, repaired.rank],
        );
      }
    }

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log(
        `Dry run: ${changedCharacters} character(s), ${removedSkills} removed skill(s), ${adjustedRanks} adjusted rank(s).`,
      );
    } else {
      await client.query('COMMIT');
      console.log(
        `Repaired ${changedCharacters} character(s), removed ${removedSkills} skill(s), adjusted ${adjustedRanks} rank(s).`,
      );
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
