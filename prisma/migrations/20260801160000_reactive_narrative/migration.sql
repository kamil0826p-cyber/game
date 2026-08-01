-- Reactive narrative operational storage.
-- Personal state and quest snapshots stay namespaced in existing JSON columns;
-- these tables provide queryable audit/idempotency and aggregate region state.

CREATE TABLE "NarrativeRegionState" (
  "realmId" UUID NOT NULL,
  "regionKey" VARCHAR(96) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "state" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NarrativeRegionState_pkey" PRIMARY KEY ("realmId", "regionKey")
);

CREATE TABLE "NarrativeOperation" (
  "scopeKey" VARCHAR(180) NOT NULL,
  "operationId" VARCHAR(128) NOT NULL,
  "eventType" VARCHAR(64) NOT NULL,
  "reason" VARCHAR(160) NOT NULL,
  "characterId" UUID,
  "characterQuestId" UUID,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NarrativeOperation_pkey" PRIMARY KEY ("scopeKey", "operationId")
);

CREATE INDEX "NarrativeRegionState_realmId_updatedAt_idx"
  ON "NarrativeRegionState"("realmId", "updatedAt");
CREATE INDEX "NarrativeOperation_characterId_createdAt_idx"
  ON "NarrativeOperation"("characterId", "createdAt");
CREATE INDEX "NarrativeOperation_characterQuestId_createdAt_idx"
  ON "NarrativeOperation"("characterQuestId", "createdAt");
CREATE INDEX "NarrativeOperation_eventType_createdAt_idx"
  ON "NarrativeOperation"("eventType", "createdAt");
