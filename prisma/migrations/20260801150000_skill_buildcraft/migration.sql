CREATE TABLE "CharacterSkillBuildState" (
  "characterId" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "data" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CharacterSkillBuildState_pkey" PRIMARY KEY ("characterId"),
  CONSTRAINT "CharacterSkillBuildState_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "Character"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CharacterSkillBuildState_updatedAt_idx"
  ON "CharacterSkillBuildState"("updatedAt");

INSERT INTO "CharacterSkillBuildState" (
  "characterId",
  "version",
  "data",
  "createdAt",
  "updatedAt"
)
SELECT
  character_row."id",
  1,
  jsonb_build_object(
    'rulesVersion', 1,
    'nodeRanks', '{}'::jsonb,
    'loadouts', jsonb_build_array(
      jsonb_build_object(
        'id', 'default',
        'name', 'Default',
        'activeSkillKeys', COALESCE(
          (
            SELECT jsonb_agg(learned."key" ORDER BY learned."displayOrder")
            FROM (
              SELECT definition."key", definition."displayOrder"
              FROM "CharacterSkill" character_skill
              JOIN "SkillDefinition" definition
                ON definition."id" = character_skill."skillDefinitionId"
              WHERE character_skill."characterId" = character_row."id"
              ORDER BY definition."displayOrder", definition."key"
              LIMIT 8
            ) learned
          ),
          '[]'::jsonb
        ),
        'passiveNodeKeys', '[]'::jsonb,
        'fallbackAction', 'DEFEND',
        'version', 1,
        'isValid', true,
        'invalidReasons', '[]'::jsonb,
        'updatedAt', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
    ),
    'activeLoadoutId', 'default',
    'freeRespecAvailable', true,
    'migration', jsonb_build_object(
      'migratedAt', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'backup', COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'skillKey', definition."key",
              'rank', character_skill."rank",
              'cooldownTurnsRemaining', character_skill."cooldownTurnsRemaining"
            )
            ORDER BY definition."displayOrder", definition."key"
          )
          FROM "CharacterSkill" character_skill
          JOIN "SkillDefinition" definition
            ON definition."id" = character_skill."skillDefinitionId"
          WHERE character_skill."characterId" = character_row."id"
        ),
        '[]'::jsonb
      )
    ),
    'operations', '{}'::jsonb,
    'audit', jsonb_build_array(
      jsonb_build_object(
        'at', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'action', 'MIGRATE',
        'beforeVersion', 0,
        'afterVersion', 1,
        'metadata', jsonb_build_object(
          'source', '20260801150000_skill_buildcraft',
          'preservedCharacterSkillRows', (
            SELECT COUNT(*)
            FROM "CharacterSkill" character_skill
            WHERE character_skill."characterId" = character_row."id"
          )
        )
      )
    )
  ),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Character" character_row
ON CONFLICT ("characterId") DO NOTHING;
