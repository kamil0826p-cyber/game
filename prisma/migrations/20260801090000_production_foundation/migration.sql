CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE "ContentVersionStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'ROLLED_BACK', 'FAILED');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'DEAD_LETTER');
CREATE TYPE "FeatureFlagScope" AS ENUM ('ACCOUNT', 'CHARACTER', 'REALM', 'GROUP', 'GUILD');

ALTER TABLE "InventoryItem"
  ADD COLUMN "definitionVersionHash" VARCHAR(64);
ALTER TABLE "CharacterQuest"
  ADD COLUMN "definitionVersionHash" VARCHAR(64);

CREATE TABLE "ContentVersion" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "hash" VARCHAR(64) NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "status" "ContentVersionStatus" NOT NULL DEFAULT 'ACTIVE',
  "manifest" JSONB NOT NULL,
  "logicalDiff" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "activatedAt" TIMESTAMP(3),
  "rolledBackAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentVersion_hash_key" UNIQUE ("hash"),
  CONSTRAINT "ContentVersion_schemaVersion_check" CHECK ("schemaVersion" > 0)
);

CREATE TABLE "ActiveContentVersion" (
  "id" VARCHAR(32) NOT NULL DEFAULT 'active',
  "contentVersionId" UUID NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActiveContentVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActiveContentVersion_contentVersionId_key" UNIQUE ("contentVersionId"),
  CONSTRAINT "ActiveContentVersion_singleton_check" CHECK ("id" = 'active')
);

CREATE TABLE "ContentDefinitionSnapshot" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contentVersionId" UUID NOT NULL,
  "category" VARCHAR(32) NOT NULL,
  "key" VARCHAR(256) NOT NULL,
  "payload" JSONB NOT NULL,
  "payloadHash" VARCHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentDefinitionSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentDefinitionSnapshot_version_category_key_key"
    UNIQUE ("contentVersionId", "category", "key")
);

CREATE TABLE "DomainEvent" (
  "id" UUID NOT NULL,
  "type" VARCHAR(128) NOT NULL,
  "version" INTEGER NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "realmId" UUID,
  "mapId" UUID,
  "characterId" UUID,
  "accountId" UUID,
  "sessionId" VARCHAR(128),
  "operationId" VARCHAR(128),
  "correlationId" VARCHAR(128),
  "contentVersionHash" VARCHAR(64),
  "clientVersion" VARCHAR(64),
  "payload" JSONB NOT NULL,
  "critical" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DomainEvent_version_check" CHECK ("version" > 0)
);

CREATE TABLE "EventOutbox" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "eventId" UUID NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lockedBy" VARCHAR(128),
  "lastError" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventOutbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EventOutbox_eventId_key" UNIQUE ("eventId"),
  CONSTRAINT "EventOutbox_attempts_check" CHECK ("attempts" >= 0)
);

CREATE TABLE "EventInbox" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "consumer" VARCHAR(128) NOT NULL,
  "eventId" UUID NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventInbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EventInbox_consumer_eventId_key" UNIQUE ("consumer", "eventId")
);

CREATE TABLE "EventDeadLetter" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "outboxId" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "attempts" INTEGER NOT NULL,
  "error" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventDeadLetter_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EventDeadLetter_outboxId_key" UNIQUE ("outboxId")
);

CREATE TABLE "FeatureFlag" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(128) NOT NULL,
  "version" INTEGER NOT NULL,
  "scope" "FeatureFlagScope" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "rolloutPercentage" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "salt" VARCHAR(128) NOT NULL,
  "variants" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "disabledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeatureFlag_key_version_key" UNIQUE ("key", "version"),
  CONSTRAINT "FeatureFlag_version_check" CHECK ("version" > 0),
  CONSTRAINT "FeatureFlag_rollout_check" CHECK ("rolloutPercentage" >= 0 AND "rolloutPercentage" <= 100)
);

CREATE TABLE "FeatureFlagAssignment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "featureFlagId" UUID NOT NULL,
  "scopeId" VARCHAR(128) NOT NULL,
  "variant" VARCHAR(64) NOT NULL,
  "bucket" INTEGER NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeatureFlagAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeatureFlagAssignment_featureFlagId_scopeId_key" UNIQUE ("featureFlagId", "scopeId"),
  CONSTRAINT "FeatureFlagAssignment_bucket_check" CHECK ("bucket" >= 0 AND "bucket" < 10000)
);

CREATE INDEX "ContentVersion_status_createdAt_idx" ON "ContentVersion"("status", "createdAt");
CREATE INDEX "ContentDefinitionSnapshot_category_key_idx" ON "ContentDefinitionSnapshot"("category", "key");
CREATE INDEX "ContentDefinitionSnapshot_payloadHash_idx" ON "ContentDefinitionSnapshot"("payloadHash");
CREATE INDEX "InventoryItem_definitionVersionHash_idx" ON "InventoryItem"("definitionVersionHash");
CREATE INDEX "CharacterQuest_definitionVersionHash_idx" ON "CharacterQuest"("definitionVersionHash");
CREATE INDEX "DomainEvent_type_occurredAt_idx" ON "DomainEvent"("type", "occurredAt");
CREATE INDEX "DomainEvent_characterId_occurredAt_idx" ON "DomainEvent"("characterId", "occurredAt");
CREATE INDEX "DomainEvent_operationId_idx" ON "DomainEvent"("operationId");
CREATE INDEX "DomainEvent_contentVersionHash_idx" ON "DomainEvent"("contentVersionHash");
CREATE INDEX "EventOutbox_status_availableAt_createdAt_idx" ON "EventOutbox"("status", "availableAt", "createdAt");
CREATE INDEX "EventOutbox_lockedAt_idx" ON "EventOutbox"("lockedAt");
CREATE INDEX "EventInbox_eventId_idx" ON "EventInbox"("eventId");
CREATE INDEX "EventDeadLetter_eventId_idx" ON "EventDeadLetter"("eventId");
CREATE INDEX "EventDeadLetter_createdAt_idx" ON "EventDeadLetter"("createdAt");
CREATE INDEX "FeatureFlag_key_enabled_idx" ON "FeatureFlag"("key", "enabled");
CREATE INDEX "FeatureFlagAssignment_scopeId_idx" ON "FeatureFlagAssignment"("scopeId");

ALTER TABLE "ActiveContentVersion"
  ADD CONSTRAINT "ActiveContentVersion_contentVersionId_fkey"
  FOREIGN KEY ("contentVersionId") REFERENCES "ContentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContentDefinitionSnapshot"
  ADD CONSTRAINT "ContentDefinitionSnapshot_contentVersionId_fkey"
  FOREIGN KEY ("contentVersionId") REFERENCES "ContentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventOutbox"
  ADD CONSTRAINT "EventOutbox_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "DomainEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventDeadLetter"
  ADD CONSTRAINT "EventDeadLetter_outboxId_fkey"
  FOREIGN KEY ("outboxId") REFERENCES "EventOutbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeatureFlagAssignment"
  ADD CONSTRAINT "FeatureFlagAssignment_featureFlagId_fkey"
  FOREIGN KEY ("featureFlagId") REFERENCES "FeatureFlag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION foundation_active_content_hash()
RETURNS VARCHAR(64)
LANGUAGE sql
STABLE
AS $$
  SELECT version."hash"
  FROM "ActiveContentVersion" active
  JOIN "ContentVersion" version ON version."id" = active."contentVersionId"
  WHERE active."id" = 'active'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION foundation_emit_domain_event(
  event_type VARCHAR,
  event_version INTEGER,
  event_character_id UUID,
  event_operation_id VARCHAR,
  event_payload JSONB,
  event_critical BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  generated_event_id UUID := gen_random_uuid();
  context_realm_id UUID;
  context_map_id UUID;
  context_account_id UUID;
BEGIN
  IF event_character_id IS NOT NULL THEN
    SELECT character."realmId", character."mapId", character."userId"
      INTO context_realm_id, context_map_id, context_account_id
    FROM "Character" character
    WHERE character."id" = event_character_id;
  END IF;

  INSERT INTO "DomainEvent" (
    "id", "type", "version", "occurredAt", "realmId", "mapId", "characterId",
    "accountId", "operationId", "contentVersionHash", "payload", "critical"
  ) VALUES (
    generated_event_id, event_type, event_version, CURRENT_TIMESTAMP,
    context_realm_id, context_map_id, event_character_id, context_account_id,
    LEFT(event_operation_id, 128), foundation_active_content_hash(),
    COALESCE(event_payload, '{}'::jsonb), event_critical
  );

  INSERT INTO "EventOutbox" ("eventId") VALUES (generated_event_id);
  RETURN generated_event_id;
END
$$;

CREATE OR REPLACE FUNCTION foundation_currency_event_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM foundation_emit_domain_event(
    'currency.changed',
    1,
    NEW."characterId",
    NEW."operationId",
    jsonb_build_object(
      'currency', NEW."currency"::text,
      'direction', NEW."direction"::text,
      'amount', NEW."amount",
      'reason', NEW."reason",
      'balanceAfter', NEW."balanceAfter",
      'ledgerId', NEW."id"
    ),
    true
  );
  RETURN NEW;
END
$$;

CREATE TRIGGER "CharacterCurrencyLedger_domain_event"
AFTER INSERT ON "CharacterCurrencyLedger"
FOR EACH ROW EXECUTE FUNCTION foundation_currency_event_trigger();

CREATE OR REPLACE FUNCTION foundation_inventory_snapshot_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."definitionVersionHash" IS NULL THEN
    NEW."definitionVersionHash" := foundation_active_content_hash();
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "InventoryItem_definition_snapshot"
BEFORE INSERT ON "InventoryItem"
FOR EACH ROW EXECUTE FUNCTION foundation_inventory_snapshot_trigger();

CREATE OR REPLACE FUNCTION foundation_inventory_event_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  operation_key VARCHAR(128);
BEGIN
  operation_key := CONCAT('inventory:', LOWER(TG_OP), ':', COALESCE(NEW."id", OLD."id")::text, ':', txid_current()::text);

  IF TG_OP = 'INSERT' THEN
    PERFORM foundation_emit_domain_event(
      'item.acquired', 1, NEW."characterId", operation_key,
      jsonb_build_object(
        'inventoryItemId', NEW."id",
        'itemDefinitionId', NEW."itemDefinitionId",
        'quantity', NEW."quantity",
        'definitionVersionHash', NEW."definitionVersionHash"
      ), true
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM foundation_emit_domain_event(
      'item.destroyed', 1, OLD."characterId", operation_key,
      jsonb_build_object(
        'inventoryItemId', OLD."id",
        'itemDefinitionId', OLD."itemDefinitionId",
        'quantity', OLD."quantity",
        'definitionVersionHash', OLD."definitionVersionHash"
      ), true
    );
    RETURN OLD;
  END IF;

  IF OLD."characterId" IS DISTINCT FROM NEW."characterId" THEN
    PERFORM foundation_emit_domain_event(
      'item.traded', 1, NEW."characterId", operation_key,
      jsonb_build_object(
        'inventoryItemId', NEW."id",
        'itemDefinitionId', NEW."itemDefinitionId",
        'quantity', NEW."quantity",
        'fromCharacterId', OLD."characterId",
        'toCharacterId', NEW."characterId",
        'definitionVersionHash', NEW."definitionVersionHash"
      ), true
    );
  ELSIF NEW."quantity" > OLD."quantity" THEN
    PERFORM foundation_emit_domain_event(
      'item.acquired', 1, NEW."characterId", operation_key,
      jsonb_build_object(
        'inventoryItemId', NEW."id",
        'itemDefinitionId', NEW."itemDefinitionId",
        'quantity', NEW."quantity" - OLD."quantity",
        'quantityAfter', NEW."quantity",
        'definitionVersionHash', NEW."definitionVersionHash"
      ), true
    );
  ELSIF NEW."quantity" < OLD."quantity" THEN
    PERFORM foundation_emit_domain_event(
      'item.consumed', 1, NEW."characterId", operation_key,
      jsonb_build_object(
        'inventoryItemId', NEW."id",
        'itemDefinitionId', NEW."itemDefinitionId",
        'quantity', OLD."quantity" - NEW."quantity",
        'quantityAfter', NEW."quantity",
        'definitionVersionHash', NEW."definitionVersionHash"
      ), true
    );
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER "InventoryItem_domain_event"
AFTER INSERT OR UPDATE OR DELETE ON "InventoryItem"
FOR EACH ROW EXECUTE FUNCTION foundation_inventory_event_trigger();

CREATE OR REPLACE FUNCTION foundation_quest_snapshot_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."definitionVersionHash" IS NULL THEN
    NEW."definitionVersionHash" := foundation_active_content_hash();
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "CharacterQuest_definition_snapshot"
BEFORE INSERT ON "CharacterQuest"
FOR EACH ROW EXECUTE FUNCTION foundation_quest_snapshot_trigger();

CREATE OR REPLACE FUNCTION foundation_quest_event_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  event_name VARCHAR(128);
  operation_key VARCHAR(128);
BEGIN
  IF TG_OP = 'INSERT' AND NEW."status" = 'ACTIVE'::"QuestProgressStatus" THEN
    event_name := 'quest.accepted';
  ELSIF TG_OP = 'UPDATE' AND NEW."status" IS DISTINCT FROM OLD."status" THEN
    event_name := CASE NEW."status"
      WHEN 'ACTIVE'::"QuestProgressStatus" THEN 'quest.accepted'
      WHEN 'COMPLETED'::"QuestProgressStatus" THEN 'quest.completed'
      WHEN 'REWARDED'::"QuestProgressStatus" THEN 'quest.rewarded'
      WHEN 'FAILED'::"QuestProgressStatus" THEN 'quest.failed'
      ELSE NULL
    END;
  END IF;

  IF event_name IS NOT NULL THEN
    operation_key := CONCAT('quest:', event_name, ':', NEW."id"::text, ':', txid_current()::text);
    PERFORM foundation_emit_domain_event(
      event_name, 1, NEW."characterId", operation_key,
      jsonb_build_object(
        'characterQuestId', NEW."id",
        'questDefinitionId', NEW."questDefinitionId",
        'status', NEW."status"::text,
        'definitionVersionHash', NEW."definitionVersionHash"
      ), true
    );
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "CharacterQuest_domain_event"
AFTER INSERT OR UPDATE ON "CharacterQuest"
FOR EACH ROW EXECUTE FUNCTION foundation_quest_event_trigger();
