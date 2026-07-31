CREATE TABLE "ContentRelease" (
  "id" UUID NOT NULL,
  "version" VARCHAR(64) NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "sourceHash" VARCHAR(64) NOT NULL,
  "operationId" VARCHAR(160) NOT NULL,
  "state" VARCHAR(24) NOT NULL,
  "manifest" JSONB NOT NULL,
  "diff" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "author" VARCHAR(160),
  "error" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activatedAt" TIMESTAMPTZ,
  "rolledBackAt" TIMESTAMPTZ,
  CONSTRAINT "ContentRelease_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentRelease_state_check" CHECK ("state" IN ('STAGED', 'ACTIVE', 'ROLLED_BACK', 'FAILED'))
);
CREATE UNIQUE INDEX "ContentRelease_version_key" ON "ContentRelease"("version");
CREATE INDEX "ContentRelease_operationId_idx" ON "ContentRelease"("operationId");
CREATE UNIQUE INDEX "ContentRelease_one_active_key" ON "ContentRelease"(("state")) WHERE "state" = 'ACTIVE';

CREATE TABLE "DomainEvent" (
  "id" UUID NOT NULL,
  "deduplicationKey" VARCHAR(200) NOT NULL,
  "operationId" VARCHAR(160) NOT NULL,
  "type" VARCHAR(120) NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "actorCharacterId" UUID,
  "realmId" UUID,
  "mapId" UUID,
  "regionKey" VARCHAR(96),
  "payload" JSONB NOT NULL,
  "occurredAt" TIMESTAMPTZ NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DomainEvent_deduplicationKey_key" ON "DomainEvent"("deduplicationKey");
CREATE INDEX "DomainEvent_operationId_idx" ON "DomainEvent"("operationId");
CREATE INDEX "DomainEvent_type_occurredAt_idx" ON "DomainEvent"("type", "occurredAt");
CREATE INDEX "DomainEvent_actorCharacterId_occurredAt_idx" ON "DomainEvent"("actorCharacterId", "occurredAt");
CREATE INDEX "DomainEvent_realmId_occurredAt_idx" ON "DomainEvent"("realmId", "occurredAt");

CREATE TABLE "EventOutbox" (
  "id" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMPTZ,
  "publishedAt" TIMESTAMPTZ,
  "lastError" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventOutbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EventOutbox_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DomainEvent"("id") ON DELETE CASCADE,
  CONSTRAINT "EventOutbox_status_check" CHECK ("status" IN ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'DEAD'))
);
CREATE UNIQUE INDEX "EventOutbox_eventId_key" ON "EventOutbox"("eventId");
CREATE INDEX "EventOutbox_status_nextAttemptAt_idx" ON "EventOutbox"("status", "nextAttemptAt");

CREATE TABLE "EventInbox" (
  "consumer" VARCHAR(120) NOT NULL,
  "eventId" UUID NOT NULL,
  "processedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventInbox_pkey" PRIMARY KEY ("consumer", "eventId"),
  CONSTRAINT "EventInbox_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DomainEvent"("id") ON DELETE CASCADE
);

CREATE TABLE "ContributionLedger" (
  "id" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "operationId" VARCHAR(160) NOT NULL,
  "subjectType" VARCHAR(32) NOT NULL,
  "subjectId" VARCHAR(128) NOT NULL,
  "kind" VARCHAR(96) NOT NULL,
  "amount" INTEGER NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContributionLedger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContributionLedger_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DomainEvent"("id") ON DELETE RESTRICT,
  CONSTRAINT "ContributionLedger_subjectType_check" CHECK ("subjectType" IN ('CHARACTER', 'PARTY', 'GUILD', 'REALM')),
  CONSTRAINT "ContributionLedger_amount_check" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "ContributionLedger_event_subject_kind_key"
  ON "ContributionLedger"("eventId", "subjectType", "subjectId", "kind");
CREATE INDEX "ContributionLedger_subject_idx"
  ON "ContributionLedger"("subjectType", "subjectId", "createdAt");
CREATE INDEX "ContributionLedger_operationId_idx" ON "ContributionLedger"("operationId");
