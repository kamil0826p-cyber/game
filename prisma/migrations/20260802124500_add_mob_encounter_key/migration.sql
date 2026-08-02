ALTER TABLE "MobDefinition"
ADD COLUMN "encounterKey" VARCHAR(96);

UPDATE "MobDefinition"
SET "encounterKey" = CASE
  WHEN "stats" ->> 'rank' = 'SPAWN' THEN 'brood-hunt'
  ELSE 'execution-circle'
END;

ALTER TABLE "MobDefinition"
ALTER COLUMN "encounterKey" SET NOT NULL;

CREATE INDEX "MobDefinition_encounterKey_idx"
ON "MobDefinition"("encounterKey");
