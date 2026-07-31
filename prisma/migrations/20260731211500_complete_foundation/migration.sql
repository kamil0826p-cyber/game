CREATE TABLE "ContentDeploymentAttempt" (
  "operationId" VARCHAR(160) NOT NULL,
  "action" VARCHAR(16) NOT NULL,
  "version" VARCHAR(64) NOT NULL,
  "sourceHash" VARCHAR(64) NOT NULL,
  "state" VARCHAR(24) NOT NULL,
  "diff" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "author" VARCHAR(160),
  "error" TEXT,
  "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMPTZ,
  CONSTRAINT "ContentDeploymentAttempt_pkey" PRIMARY KEY ("operationId"),
  CONSTRAINT "ContentDeploymentAttempt_action_check" CHECK ("action" IN ('DEPLOY', 'ROLLBACK')),
  CONSTRAINT "ContentDeploymentAttempt_state_check" CHECK ("state" IN ('STARTED', 'SUCCEEDED', 'IDEMPOTENT', 'FAILED'))
);
CREATE INDEX "ContentDeploymentAttempt_version_startedAt_idx"
  ON "ContentDeploymentAttempt"("version", "startedAt");
CREATE INDEX "ContentDeploymentAttempt_state_startedAt_idx"
  ON "ContentDeploymentAttempt"("state", "startedAt");

CREATE TABLE "ContentPatch" (
  "id" UUID NOT NULL,
  "releaseId" UUID NOT NULL,
  "entityKey" VARCHAR(200) NOT NULL,
  "changeType" VARCHAR(16) NOT NULL,
  "beforeHash" VARCHAR(64),
  "afterHash" VARCHAR(64),
  "risky" BOOLEAN NOT NULL DEFAULT FALSE,
  "riskReason" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentPatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentPatch_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "ContentRelease"("id") ON DELETE CASCADE,
  CONSTRAINT "ContentPatch_changeType_check" CHECK ("changeType" IN ('ADDED', 'CHANGED', 'REMOVED'))
);
CREATE UNIQUE INDEX "ContentPatch_release_entity_key"
  ON "ContentPatch"("releaseId", "entityKey");
CREATE INDEX "ContentPatch_entityKey_createdAt_idx"
  ON "ContentPatch"("entityKey", "createdAt");

CREATE TABLE "RewardAuditLedger" (
  "id" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "operationId" VARCHAR(160) NOT NULL,
  "characterId" UUID,
  "resourceType" VARCHAR(32) NOT NULL,
  "resourceKey" VARCHAR(128),
  "amount" INTEGER NOT NULL,
  "balanceAfter" INTEGER,
  "reason" VARCHAR(96) NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardAuditLedger_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RewardAuditLedger_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DomainEvent"("id") ON DELETE RESTRICT,
  CONSTRAINT "RewardAuditLedger_resourceType_check" CHECK ("resourceType" IN ('SILVER', 'GOLD', 'XP', 'REPUTATION', 'ITEM', 'CONTRIBUTION')),
  CONSTRAINT "RewardAuditLedger_amount_check" CHECK ("amount" <> 0)
);
CREATE UNIQUE INDEX "RewardAuditLedger_effect_key"
  ON "RewardAuditLedger"(
    "eventId",
    COALESCE("characterId", '00000000-0000-0000-0000-000000000000'::uuid),
    "resourceType",
    COALESCE("resourceKey", ''),
    "reason"
  );
CREATE INDEX "RewardAuditLedger_character_createdAt_idx"
  ON "RewardAuditLedger"("characterId", "createdAt");
CREATE INDEX "RewardAuditLedger_resource_createdAt_idx"
  ON "RewardAuditLedger"("resourceType", "resourceKey", "createdAt");
CREATE INDEX "RewardAuditLedger_operationId_idx"
  ON "RewardAuditLedger"("operationId");

CREATE UNIQUE INDEX "DomainEvent_type_operationId_key"
  ON "DomainEvent"("type", "operationId");
CREATE INDEX "EventOutbox_stale_processing_idx"
  ON "EventOutbox"("lockedAt") WHERE "status" = 'PROCESSING';

CREATE OR REPLACE FUNCTION "emit_character_quest_domain_event"()
RETURNS TRIGGER AS $$
DECLARE
  quest_key TEXT;
  quest_rewards JSONB;
  event_id UUID;
  event_type TEXT;
  operation_id TEXT;
  event_payload JSONB;
  silver_reward INTEGER;
  xp_reward INTEGER;
BEGIN
  SELECT "key", "rewards" INTO quest_key, quest_rewards
  FROM "QuestDefinition" WHERE "id" = NEW."questDefinitionId";

  IF NEW."status" = 'ACTIVE' AND (TG_OP = 'INSERT' OR OLD."status" IS DISTINCT FROM 'ACTIVE') THEN
    event_type := 'QuestChoiceMade';
    operation_id := 'quest-choice:' || NEW."id"::text || ':accept';
    event_payload := jsonb_build_object(
      'characterId', NEW."characterId"::text,
      'questKey', quest_key,
      'npcKey', 'quest:' || quest_key,
      'choiceId', 'ACCEPT'
    );
  ELSIF NEW."status" = 'REWARDED' AND (TG_OP = 'INSERT' OR OLD."status" IS DISTINCT FROM 'REWARDED') THEN
    event_type := 'QuestRewardGranted';
    operation_id := 'quest-reward:' || NEW."id"::text;
    silver_reward := COALESCE((quest_rewards->>'silver')::integer, 0);
    xp_reward := COALESCE((quest_rewards->>'experience')::integer, 0);
    event_payload := jsonb_build_object(
      'characterId', NEW."characterId"::text,
      'questKey', quest_key,
      'audit', jsonb_path_query_array(jsonb_build_array(
        CASE WHEN xp_reward > 0 THEN jsonb_build_object(
          'characterId', NEW."characterId"::text,
          'resourceType', 'XP',
          'amount', xp_reward,
          'reason', 'QUEST_REWARD',
          'metadata', jsonb_build_object('questKey', quest_key)
        ) END,
        CASE WHEN silver_reward > 0 THEN jsonb_build_object(
          'characterId', NEW."characterId"::text,
          'resourceType', 'SILVER',
          'amount', silver_reward,
          'reason', 'QUEST_REWARD',
          'metadata', jsonb_build_object('questKey', quest_key)
        ) END
      ), '$[*] ? (@ != null)')
    );
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO "DomainEvent" (
    "id", "deduplicationKey", "operationId", "type", "schemaVersion",
    "actorCharacterId", "payload", "occurredAt", "createdAt"
  ) VALUES (
    gen_random_uuid(), event_type || ':' || operation_id, operation_id, event_type, 1,
    NEW."characterId", event_payload, NOW(), NOW()
  ) ON CONFLICT DO NOTHING
  RETURNING "id" INTO event_id;

  IF event_id IS NULL THEN
    SELECT "id" INTO event_id FROM "DomainEvent"
    WHERE "type" = event_type AND "operationId" = operation_id LIMIT 1;
  END IF;

  IF event_id IS NOT NULL THEN
    INSERT INTO "EventOutbox" ("id", "eventId", "status", "nextAttemptAt", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), event_id, 'PENDING', NOW(), NOW(), NOW())
    ON CONFLICT ("eventId") DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CharacterQuest_domain_event_trigger"
AFTER INSERT OR UPDATE OF "status" ON "CharacterQuest"
FOR EACH ROW EXECUTE FUNCTION "emit_character_quest_domain_event"();

CREATE OR REPLACE FUNCTION "emit_trade_completed_domain_event"()
RETURNS TRIGGER AS $$
DECLARE
  event_id UUID;
  operation_id TEXT;
  event_payload JSONB;
  initiator_balance INTEGER;
  recipient_balance INTEGER;
BEGIN
  IF NEW."status" <> 'COMPLETED' OR (TG_OP = 'UPDATE' AND OLD."status" = 'COMPLETED') THEN
    RETURN NEW;
  END IF;

  operation_id := 'trade:' || NEW."id"::text;
  SELECT "silver" INTO initiator_balance FROM "Character" WHERE "id" = NEW."initiatorCharacterId";
  SELECT "silver" INTO recipient_balance FROM "Character" WHERE "id" = NEW."recipientCharacterId";
  event_payload := jsonb_build_object(
    'tradeId', NEW."id"::text,
    'participants', jsonb_build_array(
      jsonb_build_object(
        'characterId', NEW."initiatorCharacterId"::text,
        'silverSent', NEW."initiatorSilver",
        'silverReceived', NEW."recipientSilver"
      ),
      jsonb_build_object(
        'characterId', NEW."recipientCharacterId"::text,
        'silverSent', NEW."recipientSilver",
        'silverReceived', NEW."initiatorSilver"
      )
    ),
    'audit', jsonb_path_query_array(jsonb_build_array(
      CASE WHEN NEW."initiatorSilver" > 0 THEN jsonb_build_object(
        'characterId', NEW."initiatorCharacterId"::text,
        'resourceType', 'SILVER',
        'amount', -NEW."initiatorSilver",
        'balanceAfter', initiator_balance - NEW."recipientSilver",
        'reason', 'PLAYER_TRADE_PAYMENT',
        'metadata', jsonb_build_object('tradeId', NEW."id"::text, 'counterparty', NEW."recipientCharacterId"::text)
      ) END,
      CASE WHEN NEW."recipientSilver" > 0 THEN jsonb_build_object(
        'characterId', NEW."initiatorCharacterId"::text,
        'resourceType', 'SILVER',
        'amount', NEW."recipientSilver",
        'balanceAfter', initiator_balance,
        'reason', 'PLAYER_TRADE_RECEIPT',
        'metadata', jsonb_build_object('tradeId', NEW."id"::text, 'counterparty', NEW."recipientCharacterId"::text)
      ) END,
      CASE WHEN NEW."recipientSilver" > 0 THEN jsonb_build_object(
        'characterId', NEW."recipientCharacterId"::text,
        'resourceType', 'SILVER',
        'amount', -NEW."recipientSilver",
        'balanceAfter', recipient_balance - NEW."initiatorSilver",
        'reason', 'PLAYER_TRADE_PAYMENT',
        'metadata', jsonb_build_object('tradeId', NEW."id"::text, 'counterparty', NEW."initiatorCharacterId"::text)
      ) END,
      CASE WHEN NEW."initiatorSilver" > 0 THEN jsonb_build_object(
        'characterId', NEW."recipientCharacterId"::text,
        'resourceType', 'SILVER',
        'amount', NEW."initiatorSilver",
        'balanceAfter', recipient_balance,
        'reason', 'PLAYER_TRADE_RECEIPT',
        'metadata', jsonb_build_object('tradeId', NEW."id"::text, 'counterparty', NEW."initiatorCharacterId"::text)
      ) END
    ), '$[*] ? (@ != null)')
  );

  INSERT INTO "DomainEvent" (
    "id", "deduplicationKey", "operationId", "type", "schemaVersion",
    "payload", "occurredAt", "createdAt"
  ) VALUES (
    gen_random_uuid(), 'TradeCompleted:' || operation_id, operation_id, 'TradeCompleted', 1,
    event_payload, NOW(), NOW()
  ) ON CONFLICT DO NOTHING
  RETURNING "id" INTO event_id;

  IF event_id IS NULL THEN
    SELECT "id" INTO event_id FROM "DomainEvent"
    WHERE "type" = 'TradeCompleted' AND "operationId" = operation_id LIMIT 1;
  END IF;

  IF event_id IS NOT NULL THEN
    INSERT INTO "EventOutbox" ("id", "eventId", "status", "nextAttemptAt", "createdAt", "updatedAt")
    VALUES (gen_random_uuid(), event_id, 'PENDING', NOW(), NOW(), NOW())
    ON CONFLICT ("eventId") DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TradeSession_completed_domain_event_trigger"
AFTER INSERT OR UPDATE OF "status" ON "TradeSession"
FOR EACH ROW EXECUTE FUNCTION "emit_trade_completed_domain_event"();
