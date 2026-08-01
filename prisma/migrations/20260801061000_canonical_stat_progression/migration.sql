ALTER TABLE "Character"
  ADD COLUMN "progressionVersion" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "progressionChoices" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "legacyStatAdjustment" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN "freeProgressionRespecs" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "statRevision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Character"
  ADD CONSTRAINT "Character_progressionVersion_check" CHECK ("progressionVersion" >= 1),
  ADD CONSTRAINT "Character_freeProgressionRespecs_check" CHECK ("freeProgressionRespecs" >= 0),
  ADD CONSTRAINT "Character_progressionChoices_array_check" CHECK (jsonb_typeof("progressionChoices") = 'array'),
  ADD CONSTRAINT "Character_legacyStatAdjustment_object_check" CHECK (jsonb_typeof("legacyStatAdjustment") = 'object');

CREATE TABLE "CharacterProgressionMigrationBackup" (
  "characterId" UUID PRIMARY KEY,
  "migrationVersion" INTEGER NOT NULL,
  "level" INTEGER NOT NULL,
  "hp" INTEGER NOT NULL,
  "maxHp" INTEGER NOT NULL,
  "energy" INTEGER NOT NULL,
  "maxEnergy" INTEGER NOT NULL,
  "strength" INTEGER NOT NULL,
  "agility" INTEGER NOT NULL,
  "intelligence" INTEGER NOT NULL,
  "armor" INTEGER NOT NULL,
  "stateVersion" INTEGER NOT NULL,
  "capturedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "CharacterProgressionMigrationBackup_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE
);

CREATE TABLE "CharacterProgressionAudit" (
  "id" UUID PRIMARY KEY,
  "characterId" UUID NOT NULL,
  "operationId" VARCHAR(128) NOT NULL,
  "action" VARCHAR(32) NOT NULL,
  "progressionVersion" INTEGER NOT NULL,
  "beforeState" JSONB NOT NULL,
  "afterState" JSONB NOT NULL,
  "silverCost" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "CharacterProgressionAudit_characterId_fkey"
    FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE,
  CONSTRAINT "CharacterProgressionAudit_silverCost_check" CHECK ("silverCost" >= 0),
  CONSTRAINT "CharacterProgressionAudit_action_check" CHECK ("action" IN ('CHOICE', 'RESPEC', 'MIGRATION', 'ROLLBACK')),
  CONSTRAINT "CharacterProgressionAudit_character_operation_key" UNIQUE ("characterId", "operationId")
);

CREATE INDEX "CharacterProgressionAudit_character_created_idx"
  ON "CharacterProgressionAudit" ("characterId", "createdAt");

INSERT INTO "CharacterProgressionMigrationBackup" (
  "characterId", "migrationVersion", "level", "hp", "maxHp", "energy", "maxEnergy",
  "strength", "agility", "intelligence", "armor", "stateVersion"
)
SELECT
  "id", 2, "level", "hp", "maxHp", "energy", "maxEnergy",
  "strength", "agility", "intelligence", "armor", "stateVersion"
FROM "Character"
ON CONFLICT ("characterId") DO NOTHING;

CREATE OR REPLACE FUNCTION "canonical_base_stat"(
  p_class "CharacterClass",
  p_stat TEXT
) RETURNS INTEGER
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE p_class
    WHEN 'MAGE'::"CharacterClass" THEN CASE p_stat
      WHEN 'maxHp' THEN 75 WHEN 'maxEnergy' THEN 120 WHEN 'strength' THEN 4
      WHEN 'agility' THEN 7 WHEN 'intelligence' THEN 14 WHEN 'armor' THEN 2 ELSE 0 END
    WHEN 'WARRIOR'::"CharacterClass" THEN CASE p_stat
      WHEN 'maxHp' THEN 130 WHEN 'maxEnergy' THEN 70 WHEN 'strength' THEN 14
      WHEN 'agility' THEN 7 WHEN 'intelligence' THEN 3 WHEN 'armor' THEN 8 ELSE 0 END
    WHEN 'ARCHER'::"CharacterClass" THEN CASE p_stat
      WHEN 'maxHp' THEN 95 WHEN 'maxEnergy' THEN 95 WHEN 'strength' THEN 7
      WHEN 'agility' THEN 14 WHEN 'intelligence' THEN 5 WHEN 'armor' THEN 4 ELSE 0 END
  END;
$$;

CREATE OR REPLACE FUNCTION "canonical_progression_stat"(
  p_class "CharacterClass",
  p_level INTEGER,
  p_stat TEXT
) RETURNS INTEGER
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE p_class
    WHEN 'MAGE'::"CharacterClass" THEN CASE p_stat
      WHEN 'maxHp' THEN GREATEST(0, p_level - 1) * 6
      WHEN 'maxEnergy' THEN GREATEST(0, p_level - 1) * 6
      WHEN 'strength' THEN GREATEST(0, p_level - 1) * 1 / 5
      WHEN 'agility' THEN GREATEST(0, p_level - 1) * 9 / 20
      WHEN 'intelligence' THEN GREATEST(0, p_level - 1) * 27 / 20
      WHEN 'armor' THEN GREATEST(0, p_level - 1) * 1 / 4 ELSE 0 END
    WHEN 'WARRIOR'::"CharacterClass" THEN CASE p_stat
      WHEN 'maxHp' THEN GREATEST(0, p_level - 1) * 11
      WHEN 'maxEnergy' THEN GREATEST(0, p_level - 1) * 5 / 2
      WHEN 'strength' THEN GREATEST(0, p_level - 1) * 27 / 20
      WHEN 'agility' THEN GREATEST(0, p_level - 1) * 9 / 20
      WHEN 'intelligence' THEN GREATEST(0, p_level - 1) * 3 / 20
      WHEN 'armor' THEN GREATEST(0, p_level - 1) * 7 / 10 ELSE 0 END
    WHEN 'ARCHER'::"CharacterClass" THEN CASE p_stat
      WHEN 'maxHp' THEN GREATEST(0, p_level - 1) * 8
      WHEN 'maxEnergy' THEN GREATEST(0, p_level - 1) * 4
      WHEN 'strength' THEN GREATEST(0, p_level - 1) * 11 / 20
      WHEN 'agility' THEN GREATEST(0, p_level - 1) * 27 / 20
      WHEN 'intelligence' THEN GREATEST(0, p_level - 1) * 3 / 10
      WHEN 'armor' THEN GREATEST(0, p_level - 1) * 9 / 20 ELSE 0 END
  END;
$$;

WITH equipment AS (
  SELECT
    item."characterId",
    SUM(CASE WHEN jsonb_typeof(source.bonuses -> 'maxHp') = 'number' THEN (source.bonuses ->> 'maxHp')::INTEGER ELSE 0 END)::INTEGER AS "maxHp",
    SUM(CASE WHEN jsonb_typeof(source.bonuses -> 'maxEnergy') = 'number' THEN (source.bonuses ->> 'maxEnergy')::INTEGER ELSE 0 END)::INTEGER AS "maxEnergy",
    SUM(CASE WHEN jsonb_typeof(source.bonuses -> 'strength') = 'number' THEN (source.bonuses ->> 'strength')::INTEGER ELSE 0 END)::INTEGER AS "strength",
    SUM(CASE WHEN jsonb_typeof(source.bonuses -> 'agility') = 'number' THEN (source.bonuses ->> 'agility')::INTEGER ELSE 0 END)::INTEGER AS "agility",
    SUM(CASE WHEN jsonb_typeof(source.bonuses -> 'intelligence') = 'number' THEN (source.bonuses ->> 'intelligence')::INTEGER ELSE 0 END)::INTEGER AS "intelligence",
    SUM(CASE WHEN jsonb_typeof(source.bonuses -> 'armor') = 'number' THEN (source.bonuses ->> 'armor')::INTEGER ELSE 0 END)::INTEGER AS "armor"
  FROM "InventoryItem" item
  JOIN "ItemDefinition" definition ON definition."id" = item."itemDefinitionId"
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      item."instanceData" #> '{__contentSnapshot,definition,metadata,statBonuses}',
      definition."metadata" -> 'statBonuses',
      '{}'::jsonb
    ) AS bonuses
  ) source
  WHERE item."equippedSlot" IS NOT NULL
  GROUP BY item."characterId"
)
UPDATE "Character" character
SET
  "legacyStatAdjustment" = jsonb_build_object(
    'maxHp', character."maxHp" - "canonical_base_stat"(character."class", 'maxHp') - "canonical_progression_stat"(character."class", character."level", 'maxHp') - COALESCE(equipment."maxHp", 0),
    'maxEnergy', character."maxEnergy" - "canonical_base_stat"(character."class", 'maxEnergy') - "canonical_progression_stat"(character."class", character."level", 'maxEnergy') - COALESCE(equipment."maxEnergy", 0),
    'strength', character."strength" - "canonical_base_stat"(character."class", 'strength') - "canonical_progression_stat"(character."class", character."level", 'strength') - COALESCE(equipment."strength", 0),
    'agility', character."agility" - "canonical_base_stat"(character."class", 'agility') - "canonical_progression_stat"(character."class", character."level", 'agility') - COALESCE(equipment."agility", 0),
    'intelligence', character."intelligence" - "canonical_base_stat"(character."class", 'intelligence') - "canonical_progression_stat"(character."class", character."level", 'intelligence') - COALESCE(equipment."intelligence", 0),
    'armor', character."armor" - "canonical_base_stat"(character."class", 'armor') - "canonical_progression_stat"(character."class", character."level", 'armor') - COALESCE(equipment."armor", 0)
  ),
  "progressionVersion" = 2,
  "statRevision" = 1,
  "updatedAt" = NOW()
FROM equipment
WHERE character."id" = equipment."characterId";

UPDATE "Character" character
SET
  "legacyStatAdjustment" = jsonb_build_object(
    'maxHp', character."maxHp" - "canonical_base_stat"(character."class", 'maxHp') - "canonical_progression_stat"(character."class", character."level", 'maxHp'),
    'maxEnergy', character."maxEnergy" - "canonical_base_stat"(character."class", 'maxEnergy') - "canonical_progression_stat"(character."class", character."level", 'maxEnergy'),
    'strength', character."strength" - "canonical_base_stat"(character."class", 'strength') - "canonical_progression_stat"(character."class", character."level", 'strength'),
    'agility', character."agility" - "canonical_base_stat"(character."class", 'agility') - "canonical_progression_stat"(character."class", character."level", 'agility'),
    'intelligence', character."intelligence" - "canonical_base_stat"(character."class", 'intelligence') - "canonical_progression_stat"(character."class", character."level", 'intelligence'),
    'armor', character."armor" - "canonical_base_stat"(character."class", 'armor') - "canonical_progression_stat"(character."class", character."level", 'armor')
  ),
  "progressionVersion" = 2,
  "statRevision" = 1,
  "updatedAt" = NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "InventoryItem"
  WHERE "InventoryItem"."characterId" = character."id"
    AND "InventoryItem"."equippedSlot" IS NOT NULL
);

INSERT INTO "CharacterProgressionAudit" (
  "id", "characterId", "operationId", "action", "progressionVersion",
  "beforeState", "afterState", "silverCost", "createdAt"
)
SELECT
  gen_random_uuid(), character."id", 'migration:v2', 'MIGRATION', 2,
  jsonb_build_object(
    'level', backup."level", 'hp', backup."hp", 'maxHp', backup."maxHp",
    'energy', backup."energy", 'maxEnergy', backup."maxEnergy",
    'strength', backup."strength", 'agility', backup."agility",
    'intelligence', backup."intelligence", 'armor', backup."armor"
  ),
  jsonb_build_object(
    'progressionVersion', character."progressionVersion",
    'progressionChoices', character."progressionChoices",
    'legacyStatAdjustment', character."legacyStatAdjustment"
  ),
  0,
  NOW()
FROM "Character" character
JOIN "CharacterProgressionMigrationBackup" backup ON backup."characterId" = character."id"
ON CONFLICT ("characterId", "operationId") DO NOTHING;
