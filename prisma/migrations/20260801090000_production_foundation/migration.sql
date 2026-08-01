CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE "ContentRelease" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sequence" BIGSERIAL NOT NULL,
  "hash" VARCHAR(64) NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "manifest" JSONB NOT NULL,
  "logicalDiff" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "status" VARCHAR(24) NOT NULL DEFAULT 'STAGED',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activatedAt" TIMESTAMPTZ,
  "rolledBackAt" TIMESTAMPTZ,
  CONSTRAINT "ContentRelease_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentRelease_sequence_key" UNIQUE ("sequence"),
  CONSTRAINT "ContentRelease_hash_key" UNIQUE ("hash"),
  CONSTRAINT "ContentRelease_status_check" CHECK ("status" IN ('STAGED', 'ACTIVE', 'SUPERSEDED', 'ROLLED_BACK'))
);

CREATE TABLE "ContentState" (
  "key" VARCHAR(64) NOT NULL,
  "activeReleaseId" UUID,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentState_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "ContentState_activeReleaseId_fkey" FOREIGN KEY ("activeReleaseId") REFERENCES "ContentRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ContentDefinition" (
  "releaseId" UUID NOT NULL,
  "section" VARCHAR(48) NOT NULL,
  "key" VARCHAR(160) NOT NULL,
  "body" JSONB NOT NULL,
  CONSTRAINT "ContentDefinition_pkey" PRIMARY KEY ("releaseId", "section", "key"),
  CONSTRAINT "ContentDefinition_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "ContentRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ContentDefinition_section_key_idx" ON "ContentDefinition"("section", "key");

CREATE TABLE "DomainEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "eventType" VARCHAR(160) NOT NULL,
  "eventVersion" INTEGER NOT NULL,
  "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "serverTime" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "realmId" UUID,
  "mapId" UUID,
  "characterId" UUID,
  "accountId" UUID,
  "sessionId" VARCHAR(160),
  "operationId" VARCHAR(160),
  "correlationId" VARCHAR(160),
  "contentHash" VARCHAR(64),
  "clientVersion" VARCHAR(64),
  "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DomainEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DomainEvent_eventVersion_check" CHECK ("eventVersion" > 0)
);
CREATE INDEX "DomainEvent_eventType_occurredAt_idx" ON "DomainEvent"("eventType", "occurredAt");
CREATE INDEX "DomainEvent_characterId_occurredAt_idx" ON "DomainEvent"("characterId", "occurredAt");
CREATE INDEX "DomainEvent_accountId_occurredAt_idx" ON "DomainEvent"("accountId", "occurredAt");
CREATE INDEX "DomainEvent_contentHash_idx" ON "DomainEvent"("contentHash");

CREATE TABLE "DomainOutbox" (
  "id" BIGSERIAL NOT NULL,
  "eventId" UUID NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMPTZ,
  "lockedBy" VARCHAR(160),
  "lastError" TEXT,
  "deliveredAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DomainOutbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DomainOutbox_eventId_key" UNIQUE ("eventId"),
  CONSTRAINT "DomainOutbox_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DomainEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DomainOutbox_status_check" CHECK ("status" IN ('PENDING', 'PROCESSING', 'DELIVERED', 'DEAD')),
  CONSTRAINT "DomainOutbox_attempts_check" CHECK ("attempts" >= 0)
);
CREATE INDEX "DomainOutbox_claim_idx" ON "DomainOutbox"("status", "availableAt", "id");
CREATE INDEX "DomainOutbox_lockedAt_idx" ON "DomainOutbox"("lockedAt") WHERE "status" = 'PROCESSING';

CREATE TABLE "DomainInbox" (
  "consumer" VARCHAR(160) NOT NULL,
  "eventId" UUID NOT NULL,
  "claimedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMPTZ,
  "resultHash" VARCHAR(64),
  CONSTRAINT "DomainInbox_pkey" PRIMARY KEY ("consumer", "eventId"),
  CONSTRAINT "DomainInbox_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DomainEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DomainInbox_processedAt_idx" ON "DomainInbox"("processedAt");

CREATE TABLE "FeatureFlag" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" VARCHAR(128) NOT NULL,
  "version" INTEGER NOT NULL,
  "scope" VARCHAR(24) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "rolloutBasisPoints" INTEGER NOT NULL DEFAULT 0,
  "variants" JSONB NOT NULL DEFAULT '[{"key":"control","weight":10000}]'::jsonb,
  "salt" VARCHAR(128) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disabledAt" TIMESTAMPTZ,
  CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeatureFlag_key_version_key" UNIQUE ("key", "version"),
  CONSTRAINT "FeatureFlag_scope_check" CHECK ("scope" IN ('ACCOUNT', 'CHARACTER', 'REALM', 'GROUP', 'GUILD')),
  CONSTRAINT "FeatureFlag_rollout_check" CHECK ("rolloutBasisPoints" BETWEEN 0 AND 10000)
);
CREATE INDEX "FeatureFlag_key_enabled_idx" ON "FeatureFlag"("key", "enabled", "version");

CREATE TABLE "FeatureFlagAssignment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "flagKey" VARCHAR(128) NOT NULL,
  "flagVersion" INTEGER NOT NULL,
  "scope" VARCHAR(24) NOT NULL,
  "subjectId" VARCHAR(160) NOT NULL,
  "bucket" INTEGER NOT NULL,
  "variant" VARCHAR(128) NOT NULL,
  "assignedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeatureFlagAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeatureFlagAssignment_identity_key" UNIQUE ("flagKey", "flagVersion", "scope", "subjectId"),
  CONSTRAINT "FeatureFlagAssignment_flag_fkey" FOREIGN KEY ("flagKey", "flagVersion") REFERENCES "FeatureFlag"("key", "version") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FeatureFlagAssignment_bucket_check" CHECK ("bucket" BETWEEN 0 AND 9999)
);
CREATE INDEX "FeatureFlagAssignment_subject_idx" ON "FeatureFlagAssignment"("scope", "subjectId");

ALTER TABLE "Map" ADD COLUMN IF NOT EXISTS "contentHash" VARCHAR(64);
ALTER TABLE "SkillDefinition" ADD COLUMN IF NOT EXISTS "contentHash" VARCHAR(64);
ALTER TABLE "ItemDefinition" ADD COLUMN IF NOT EXISTS "contentHash" VARCHAR(64);
ALTER TABLE "QuestDefinition" ADD COLUMN IF NOT EXISTS "contentHash" VARCHAR(64);
ALTER TABLE "NpcDefinition" ADD COLUMN IF NOT EXISTS "contentHash" VARCHAR(64);
ALTER TABLE "MobDefinition" ADD COLUMN IF NOT EXISTS "contentHash" VARCHAR(64);
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "definitionContentHash" VARCHAR(64);
ALTER TABLE "CharacterQuest" ADD COLUMN IF NOT EXISTS "definitionContentHash" VARCHAR(64);

CREATE OR REPLACE FUNCTION foundation_active_content_hash()
RETURNS VARCHAR
LANGUAGE SQL
STABLE
AS $$
  SELECT release."hash"
  FROM "ContentState" state
  JOIN "ContentRelease" release ON release."id" = state."activeReleaseId"
  WHERE state."key" = 'global'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION foundation_sanitize_jsonb(input JSONB)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF input IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;
  CASE jsonb_typeof(input)
    WHEN 'object' THEN
      RETURN COALESCE((
        SELECT jsonb_object_agg(
          key,
          CASE
            WHEN lower(key) ~ '(^|_)(chat|message|content|email|authorization|cookie|token|firebase|secret|password|credential)s?($|_)'
              THEN '"[REDACTED]"'::jsonb
            ELSE foundation_sanitize_jsonb(value)
          END
        )
        FROM jsonb_each(input)
      ), '{}'::jsonb);
    WHEN 'array' THEN
      RETURN COALESCE((
        SELECT jsonb_agg(foundation_sanitize_jsonb(value))
        FROM jsonb_array_elements(input)
      ), '[]'::jsonb);
    ELSE
      RETURN input;
  END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION foundation_emit_domain_event(
  p_event_type VARCHAR,
  p_event_version INTEGER,
  p_realm_id UUID,
  p_map_id UUID,
  p_character_id UUID,
  p_account_id UUID,
  p_operation_id VARCHAR,
  p_correlation_id VARCHAR,
  p_payload JSONB
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id UUID := gen_random_uuid();
BEGIN
  INSERT INTO "DomainEvent" (
    "id", "eventType", "eventVersion", "realmId", "mapId", "characterId", "accountId",
    "operationId", "correlationId", "contentHash", "payload"
  ) VALUES (
    v_event_id,
    p_event_type,
    p_event_version,
    p_realm_id,
    p_map_id,
    p_character_id,
    p_account_id,
    NULLIF(p_operation_id, ''),
    NULLIF(p_correlation_id, ''),
    foundation_active_content_hash(),
    foundation_sanitize_jsonb(COALESCE(p_payload, '{}'::jsonb))
  );
  INSERT INTO "DomainOutbox" ("eventId") VALUES (v_event_id);
  RETURN v_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION foundation_snapshot_inventory_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."definitionContentHash" IS NULL THEN
    SELECT COALESCE(definition."contentHash", foundation_active_content_hash())
    INTO NEW."definitionContentHash"
    FROM "ItemDefinition" definition
    WHERE definition."id" = NEW."itemDefinitionId";
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION foundation_snapshot_quest_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."definitionContentHash" IS NULL THEN
    SELECT COALESCE(definition."contentHash", foundation_active_content_hash())
    INTO NEW."definitionContentHash"
    FROM "QuestDefinition" definition
    WHERE definition."id" = NEW."questDefinitionId";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "InventoryItem_definition_version"
BEFORE INSERT ON "InventoryItem"
FOR EACH ROW EXECUTE FUNCTION foundation_snapshot_inventory_version();

CREATE TRIGGER "CharacterQuest_definition_version"
BEFORE INSERT ON "CharacterQuest"
FOR EACH ROW EXECUTE FUNCTION foundation_snapshot_quest_version();

CREATE OR REPLACE FUNCTION foundation_currency_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_character "Character"%ROWTYPE;
BEGIN
  SELECT * INTO v_character FROM "Character" WHERE "id" = NEW."characterId";
  PERFORM foundation_emit_domain_event(
    'economy.currency.changed',
    1,
    v_character."realmId",
    v_character."mapId",
    NEW."characterId",
    v_character."userId",
    NEW."operationId",
    NEW."operationId",
    jsonb_build_object(
      'currency', NEW."currency",
      'direction', NEW."direction",
      'amount', NEW."amount",
      'reason', NEW."reason",
      'balanceAfter', NEW."balanceAfter",
      'metadata', NEW."metadata"
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CharacterCurrencyLedger_domain_event"
AFTER INSERT ON "CharacterCurrencyLedger"
FOR EACH ROW EXECUTE FUNCTION foundation_currency_event();

CREATE OR REPLACE FUNCTION foundation_inventory_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_character_id UUID;
  v_definition_id UUID;
  v_item_id UUID;
  v_character "Character"%ROWTYPE;
  v_item_key VARCHAR;
  v_event_type VARCHAR;
  v_operation_id VARCHAR;
  v_old_quantity INTEGER;
  v_new_quantity INTEGER;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_character_id := OLD."characterId";
    v_definition_id := OLD."itemDefinitionId";
    v_item_id := OLD."id";
    v_old_quantity := OLD."quantity";
    v_new_quantity := 0;
    v_event_type := 'item.destroyed';
  ELSE
    v_character_id := NEW."characterId";
    v_definition_id := NEW."itemDefinitionId";
    v_item_id := NEW."id";
    v_old_quantity := CASE WHEN TG_OP = 'UPDATE' THEN OLD."quantity" ELSE 0 END;
    v_new_quantity := NEW."quantity";
    IF TG_OP = 'INSERT' THEN
      v_event_type := 'item.acquired';
    ELSIF OLD."characterId" IS DISTINCT FROM NEW."characterId" THEN
      v_event_type := 'item.traded';
    ELSIF NEW."quantity" > OLD."quantity" THEN
      v_event_type := 'item.acquired';
    ELSIF NEW."quantity" < OLD."quantity" THEN
      v_event_type := 'item.consumed';
    ELSE
      RETURN NEW;
    END IF;
  END IF;

  SELECT * INTO v_character FROM "Character" WHERE "id" = v_character_id;
  SELECT "key" INTO v_item_key FROM "ItemDefinition" WHERE "id" = v_definition_id;
  v_operation_id := COALESCE(NULLIF(current_setting('app.operation_id', true), ''), CONCAT('inventory:', v_item_id::text, ':', txid_current()::text));
  PERFORM foundation_emit_domain_event(
    v_event_type,
    1,
    v_character."realmId",
    v_character."mapId",
    v_character_id,
    v_character."userId",
    v_operation_id,
    NULLIF(current_setting('app.correlation_id', true), ''),
    jsonb_build_object(
      'inventoryItemId', v_item_id,
      'itemKey', v_item_key,
      'oldQuantity', v_old_quantity,
      'newQuantity', v_new_quantity,
      'definitionContentHash', CASE WHEN TG_OP = 'DELETE' THEN OLD."definitionContentHash" ELSE NEW."definitionContentHash" END
    )
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "InventoryItem_domain_event"
AFTER INSERT OR UPDATE OR DELETE ON "InventoryItem"
FOR EACH ROW EXECUTE FUNCTION foundation_inventory_event();

CREATE OR REPLACE FUNCTION foundation_quest_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_character "Character"%ROWTYPE;
  v_quest_key VARCHAR;
  v_event_type VARCHAR;
  v_operation_id VARCHAR;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" = 'ACTIVE' THEN v_event_type := 'quest.accepted';
    ELSE RETURN NEW;
    END IF;
  ELSIF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    RETURN NEW;
  ELSE
    v_event_type := CASE NEW."status"
      WHEN 'ACTIVE' THEN 'quest.accepted'
      WHEN 'COMPLETED' THEN 'quest.completed'
      WHEN 'REWARDED' THEN 'quest.rewarded'
      WHEN 'FAILED' THEN 'quest.failed'
      ELSE NULL
    END;
    IF v_event_type IS NULL THEN RETURN NEW; END IF;
  END IF;

  SELECT * INTO v_character FROM "Character" WHERE "id" = NEW."characterId";
  SELECT "key" INTO v_quest_key FROM "QuestDefinition" WHERE "id" = NEW."questDefinitionId";
  v_operation_id := COALESCE(NULLIF(current_setting('app.operation_id', true), ''), CONCAT('quest:', NEW."id"::text, ':', NEW."status"::text));
  PERFORM foundation_emit_domain_event(
    v_event_type,
    1,
    v_character."realmId",
    v_character."mapId",
    NEW."characterId",
    v_character."userId",
    v_operation_id,
    NULLIF(current_setting('app.correlation_id', true), ''),
    jsonb_build_object(
      'questKey', v_quest_key,
      'previousStatus', CASE WHEN TG_OP = 'UPDATE' THEN OLD."status"::text ELSE NULL END,
      'status', NEW."status",
      'progress', NEW."progress",
      'definitionContentHash', NEW."definitionContentHash"
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CharacterQuest_domain_event"
AFTER INSERT OR UPDATE ON "CharacterQuest"
FOR EACH ROW EXECUTE FUNCTION foundation_quest_event();

CREATE OR REPLACE FUNCTION foundation_user_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM foundation_emit_domain_event(
    'account.created', 1, NULL, NULL, NULL, NEW."id",
    CONCAT('account:', NEW."id"::text, ':created'), NULL,
    jsonb_build_object('role', NEW."role")
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER "User_domain_event" AFTER INSERT ON "User" FOR EACH ROW EXECUTE FUNCTION foundation_user_event();

CREATE OR REPLACE FUNCTION foundation_character_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_operation_id VARCHAR;
BEGIN
  v_operation_id := COALESCE(NULLIF(current_setting('app.operation_id', true), ''), CONCAT('character:', NEW."id"::text, ':', txid_current()::text));
  IF TG_OP = 'INSERT' THEN
    PERFORM foundation_emit_domain_event(
      'character.created', 1, NEW."realmId", NEW."mapId", NEW."id", NEW."userId",
      v_operation_id, NULL, jsonb_build_object('class', NEW."class", 'level', NEW."level")
    );
    PERFORM foundation_emit_domain_event(
      'world.map.entered', 1, NEW."realmId", NEW."mapId", NEW."id", NEW."userId",
      v_operation_id, NULL, jsonb_build_object('x', NEW."x", 'y', NEW."y", 'initial', true)
    );
    RETURN NEW;
  END IF;

  IF OLD."mapId" IS DISTINCT FROM NEW."mapId" THEN
    PERFORM foundation_emit_domain_event(
      'world.map.exited', 1, OLD."realmId", OLD."mapId", NEW."id", NEW."userId",
      v_operation_id, NULL, jsonb_build_object('x', OLD."x", 'y', OLD."y")
    );
    PERFORM foundation_emit_domain_event(
      'world.map.entered', 1, NEW."realmId", NEW."mapId", NEW."id", NEW."userId",
      v_operation_id, NULL, jsonb_build_object('x', NEW."x", 'y', NEW."y")
    );
  END IF;
  IF OLD."experience" IS DISTINCT FROM NEW."experience" THEN
    PERFORM foundation_emit_domain_event(
      'progression.xp.changed', 1, NEW."realmId", NEW."mapId", NEW."id", NEW."userId",
      v_operation_id, NULL, jsonb_build_object('before', OLD."experience", 'after', NEW."experience", 'delta', NEW."experience" - OLD."experience")
    );
  END IF;
  IF OLD."level" IS DISTINCT FROM NEW."level" THEN
    PERFORM foundation_emit_domain_event(
      'progression.level.up', 1, NEW."realmId", NEW."mapId", NEW."id", NEW."userId",
      v_operation_id, NULL, jsonb_build_object('before', OLD."level", 'after', NEW."level")
    );
  END IF;
  IF OLD."combatState" IS DISTINCT FROM NEW."combatState" THEN
    PERFORM foundation_emit_domain_event(
      CASE WHEN NEW."combatState" = 'IN_BATTLE' THEN 'combat.started' ELSE 'combat.finished' END,
      1, NEW."realmId", NEW."mapId", NEW."id", NEW."userId",
      v_operation_id, NULL, jsonb_build_object('before', OLD."combatState", 'after', NEW."combatState")
    );
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Character_domain_event" AFTER INSERT OR UPDATE ON "Character" FOR EACH ROW EXECUTE FUNCTION foundation_character_event();

CREATE OR REPLACE FUNCTION foundation_guild_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM foundation_emit_domain_event(
      'guild.created', 1, NEW."realmId", NULL, NULL, NULL,
      CONCAT('guild:', NEW."id"::text, ':created'), NULL,
      jsonb_build_object('guildId', NEW."id", 'tag', NEW."tag")
    );
    RETURN NEW;
  END IF;
  PERFORM foundation_emit_domain_event(
    'guild.disbanded', 1, OLD."realmId", NULL, NULL, NULL,
    CONCAT('guild:', OLD."id"::text, ':disbanded'), NULL,
    jsonb_build_object('guildId', OLD."id", 'tag', OLD."tag")
  );
  RETURN OLD;
END;
$$;
CREATE TRIGGER "Guild_domain_event" AFTER INSERT OR DELETE ON "Guild" FOR EACH ROW EXECUTE FUNCTION foundation_guild_event();

CREATE OR REPLACE FUNCTION foundation_guild_member_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_character "Character"%ROWTYPE;
  v_guild_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_guild_id := NEW."guildId";
    SELECT * INTO v_character FROM "Character" WHERE "id" = NEW."characterId";
    PERFORM foundation_emit_domain_event(
      'guild.member.joined', 1, v_character."realmId", v_character."mapId", NEW."characterId", v_character."userId",
      CONCAT('guild-member:', NEW."id"::text, ':joined'), NULL,
      jsonb_build_object('guildId', v_guild_id, 'role', NEW."role")
    );
    RETURN NEW;
  END IF;
  v_guild_id := OLD."guildId";
  SELECT * INTO v_character FROM "Character" WHERE "id" = OLD."characterId";
  PERFORM foundation_emit_domain_event(
    'guild.member.left', 1, v_character."realmId", v_character."mapId", OLD."characterId", v_character."userId",
    CONCAT('guild-member:', OLD."id"::text, ':left'), NULL,
    jsonb_build_object('guildId', v_guild_id, 'role', OLD."role")
  );
  RETURN OLD;
END;
$$;
CREATE TRIGGER "GuildMember_domain_event" AFTER INSERT OR DELETE ON "GuildMember" FOR EACH ROW EXECUTE FUNCTION foundation_guild_member_event();

CREATE OR REPLACE FUNCTION foundation_trade_event()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_character "Character"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."status" IS NOT DISTINCT FROM OLD."status" THEN RETURN NEW; END IF;
  SELECT * INTO v_character FROM "Character" WHERE "id" = NEW."initiatorCharacterId";
  PERFORM foundation_emit_domain_event(
    CONCAT('trade.', lower(NEW."status"::text)), 1,
    v_character."realmId", v_character."mapId", NEW."initiatorCharacterId", v_character."userId",
    CONCAT('trade:', NEW."id"::text, ':', NEW."status"::text), NEW."id"::text,
    jsonb_build_object(
      'tradeId', NEW."id",
      'initiatorCharacterId', NEW."initiatorCharacterId",
      'recipientCharacterId', NEW."recipientCharacterId",
      'status', NEW."status",
      'initiatorSilver', NEW."initiatorSilver",
      'recipientSilver', NEW."recipientSilver"
    )
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER "TradeSession_domain_event" AFTER INSERT OR UPDATE ON "TradeSession" FOR EACH ROW EXECUTE FUNCTION foundation_trade_event();
