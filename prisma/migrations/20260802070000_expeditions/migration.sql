CREATE TYPE "ExpeditionRunStatus" AS ENUM (
  'PREPARING',
  'ACTIVE',
  'EXTRACTED',
  'FAILED',
  'ABANDONED',
  'COMPLETED'
);

CREATE TABLE "ExpeditionRun" (
  "id" UUID NOT NULL,
  "realmId" UUID NOT NULL,
  "leaderCharacterId" UUID NOT NULL,
  "definitionKey" VARCHAR(96) NOT NULL,
  "definitionVersion" INTEGER NOT NULL,
  "contentVersion" VARCHAR(64) NOT NULL,
  "seed" INTEGER NOT NULL,
  "status" "ExpeditionRunStatus" NOT NULL DEFAULT 'PREPARING',
  "currentNodeKey" VARCHAR(96) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "snapshot" JSONB NOT NULL,
  "startedAt" TIMESTAMP(3),
  "terminalAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExpeditionRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExpeditionMember" (
  "runId" UUID NOT NULL,
  "characterId" UUID NOT NULL,
  "roleKey" VARCHAR(64) NOT NULL,
  "formation" VARCHAR(16) NOT NULL,
  "loadoutSnapshot" JSONB NOT NULL,
  "riskAccepted" BOOLEAN NOT NULL,
  "rewardEligible" BOOLEAN NOT NULL DEFAULT true,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disconnectedAt" TIMESTAMP(3),
  CONSTRAINT "ExpeditionMember_pkey" PRIMARY KEY ("runId", "characterId")
);

CREATE TABLE "ExpeditionActiveMember" (
  "characterId" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExpeditionActiveMember_pkey" PRIMARY KEY ("characterId")
);

CREATE TABLE "ExpeditionOperation" (
  "runId" UUID NOT NULL,
  "operationId" VARCHAR(128) NOT NULL,
  "operationType" VARCHAR(48) NOT NULL,
  "status" VARCHAR(16) NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "ExpeditionOperation_pkey" PRIMARY KEY ("runId", "operationId")
);

CREATE TABLE "ExpeditionRewardLedger" (
  "id" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "characterId" UUID NOT NULL,
  "operationId" VARCHAR(128) NOT NULL,
  "definitionVersion" INTEGER NOT NULL,
  "settlement" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExpeditionRewardLedger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExpeditionRun_realmId_status_idx" ON "ExpeditionRun"("realmId", "status");
CREATE INDEX "ExpeditionRun_leaderCharacterId_status_idx" ON "ExpeditionRun"("leaderCharacterId", "status");
CREATE INDEX "ExpeditionRun_definitionKey_definitionVersion_idx" ON "ExpeditionRun"("definitionKey", "definitionVersion");
CREATE INDEX "ExpeditionMember_characterId_joinedAt_idx" ON "ExpeditionMember"("characterId", "joinedAt");
CREATE INDEX "ExpeditionActiveMember_runId_idx" ON "ExpeditionActiveMember"("runId");
CREATE INDEX "ExpeditionOperation_status_createdAt_idx" ON "ExpeditionOperation"("status", "createdAt");
CREATE INDEX "ExpeditionRewardLedger_characterId_createdAt_idx" ON "ExpeditionRewardLedger"("characterId", "createdAt");
CREATE UNIQUE INDEX "ExpeditionRewardLedger_runId_characterId_key" ON "ExpeditionRewardLedger"("runId", "characterId");
CREATE UNIQUE INDEX "ExpeditionRewardLedger_characterId_operationId_key" ON "ExpeditionRewardLedger"("characterId", "operationId");

ALTER TABLE "ExpeditionMember"
  ADD CONSTRAINT "ExpeditionMember_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "ExpeditionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExpeditionOperation"
  ADD CONSTRAINT "ExpeditionOperation_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "ExpeditionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExpeditionRewardLedger"
  ADD CONSTRAINT "ExpeditionRewardLedger_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "ExpeditionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExpeditionActiveMember"
  ADD CONSTRAINT "ExpeditionActiveMember_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "ExpeditionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE FUNCTION "guard_active_expedition_equipment"()
RETURNS TRIGGER AS $$
DECLARE
  character_id UUID;
BEGIN
  character_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."characterId" ELSE NEW."characterId" END;
  IF (
    (TG_OP = 'DELETE' AND OLD."equippedSlot" IS NOT NULL) OR
    (TG_OP = 'UPDATE' AND NEW."equippedSlot" IS DISTINCT FROM OLD."equippedSlot")
  ) AND EXISTS (
    SELECT 1
    FROM "ExpeditionActiveMember" active_member
    JOIN "ExpeditionRun" run ON run."id" = active_member."runId"
    WHERE active_member."characterId" = character_id
      AND run."status" IN ('PREPARING', 'ACTIVE')
  ) THEN
    RAISE EXCEPTION 'EXPEDITION_LOADOUT_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InventoryItem_active_expedition_loadout_guard"
BEFORE UPDATE OF "equippedSlot" OR DELETE ON "InventoryItem"
FOR EACH ROW EXECUTE FUNCTION "guard_active_expedition_equipment"();

CREATE FUNCTION "guard_active_expedition_skill_build"()
RETURNS TRIGGER AS $$
DECLARE
  character_id UUID;
BEGIN
  character_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."characterId" ELSE NEW."characterId" END;
  IF EXISTS (
    SELECT 1
    FROM "ExpeditionActiveMember" active_member
    JOIN "ExpeditionRun" run ON run."id" = active_member."runId"
    WHERE active_member."characterId" = character_id
      AND run."status" IN ('PREPARING', 'ACTIVE')
  ) THEN
    RAISE EXCEPTION 'EXPEDITION_LOADOUT_LOCKED' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CharacterSkillBuildState_active_expedition_loadout_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "CharacterSkillBuildState"
FOR EACH ROW EXECUTE FUNCTION "guard_active_expedition_skill_build"();
