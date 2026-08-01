CREATE TABLE "EncounterRewardLedger" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "characterId" UUID NOT NULL,
  "operationId" VARCHAR(128) NOT NULL,
  "combatId" UUID NOT NULL,
  "encounterKey" VARCHAR(96) NOT NULL,
  "settlement" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EncounterRewardLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EncounterRewardLedger_characterId_operationId_key"
ON "EncounterRewardLedger"("characterId", "operationId");

CREATE UNIQUE INDEX "EncounterRewardLedger_characterId_combatId_key"
ON "EncounterRewardLedger"("characterId", "combatId");

CREATE INDEX "EncounterRewardLedger_combatId_idx"
ON "EncounterRewardLedger"("combatId");

CREATE INDEX "EncounterRewardLedger_characterId_createdAt_idx"
ON "EncounterRewardLedger"("characterId", "createdAt");

ALTER TABLE "EncounterRewardLedger"
ADD CONSTRAINT "EncounterRewardLedger_characterId_fkey"
FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
