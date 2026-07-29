-- Turn-based skill metadata and a normalized prerequisite graph.
CREATE TYPE "SkillTargeting" AS ENUM ('SELF', 'ENEMY', 'AREA');

ALTER TABLE "SkillDefinition"
  RENAME COLUMN "metadata" TO "effectDefinition";

ALTER TABLE "SkillDefinition"
  ADD COLUMN "cooldownTurns" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "targeting" "SkillTargeting" NOT NULL DEFAULT 'ENEMY',
  ADD COLUMN "maxRank" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "treeRow" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "treeColumn" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "icon" VARCHAR(16) NOT NULL DEFAULT '✦',
  ADD COLUMN "animationKey" VARCHAR(96) NOT NULL DEFAULT 'none',
  ADD COLUMN "visualDefinition" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "CharacterSkill"
  DROP COLUMN "cooldownEndsAt",
  ADD COLUMN "cooldownTurnsRemaining" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "SkillPrerequisite" (
  "skillDefinitionId" UUID NOT NULL,
  "prerequisiteSkillDefinitionId" UUID NOT NULL,
  CONSTRAINT "SkillPrerequisite_pkey" PRIMARY KEY ("skillDefinitionId", "prerequisiteSkillDefinitionId")
);

ALTER TABLE "SkillPrerequisite"
  ADD CONSTRAINT "SkillPrerequisite_skillDefinitionId_fkey"
  FOREIGN KEY ("skillDefinitionId") REFERENCES "SkillDefinition"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SkillPrerequisite"
  ADD CONSTRAINT "SkillPrerequisite_prerequisiteSkillDefinitionId_fkey"
  FOREIGN KEY ("prerequisiteSkillDefinitionId") REFERENCES "SkillDefinition"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "SkillDefinition_requiredClass_displayOrder_idx"
  ON "SkillDefinition"("requiredClass", "displayOrder");

CREATE INDEX "SkillPrerequisite_prerequisiteSkillDefinitionId_idx"
  ON "SkillPrerequisite"("prerequisiteSkillDefinitionId");
