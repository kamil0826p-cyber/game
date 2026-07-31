CREATE TABLE "AnalyticsEvent" (
  "id" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "eventName" VARCHAR(120) NOT NULL,
  "envelopeVersion" INTEGER NOT NULL,
  "sourceType" VARCHAR(120) NOT NULL,
  "sourceSchemaVersion" INTEGER NOT NULL,
  "accountId" UUID,
  "characterId" UUID,
  "realmId" UUID,
  "mapId" UUID,
  "regionKey" VARCHAR(128),
  "sessionId" VARCHAR(128),
  "clientVersion" VARCHAR(64),
  "contentVersion" VARCHAR(64) NOT NULL,
  "operationId" VARCHAR(160) NOT NULL,
  "correlationId" VARCHAR(160) NOT NULL,
  "occurredAt" TIMESTAMPTZ NOT NULL,
  "ingestedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "properties" JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AnalyticsEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "DomainEvent"("id") ON DELETE CASCADE,
  CONSTRAINT "AnalyticsEvent_envelopeVersion_check" CHECK ("envelopeVersion" > 0),
  CONSTRAINT "AnalyticsEvent_sourceSchemaVersion_check" CHECK ("sourceSchemaVersion" > 0)
);
CREATE UNIQUE INDEX "AnalyticsEvent_eventId_key" ON "AnalyticsEvent"("eventId");
CREATE INDEX "AnalyticsEvent_name_occurredAt_idx" ON "AnalyticsEvent"("eventName", "occurredAt");
CREATE INDEX "AnalyticsEvent_account_occurredAt_idx" ON "AnalyticsEvent"("accountId", "occurredAt");
CREATE INDEX "AnalyticsEvent_character_occurredAt_idx" ON "AnalyticsEvent"("characterId", "occurredAt");
CREATE INDEX "AnalyticsEvent_realm_name_occurredAt_idx" ON "AnalyticsEvent"("realmId", "eventName", "occurredAt");
CREATE INDEX "AnalyticsEvent_correlation_idx" ON "AnalyticsEvent"("correlationId");

CREATE TABLE "AnalyticsDelivery" (
  "id" UUID NOT NULL,
  "analyticsEventId" UUID NOT NULL,
  "provider" VARCHAR(32) NOT NULL,
  "status" VARCHAR(24) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMPTZ,
  "sentAt" TIMESTAMPTZ,
  "lastError" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsDelivery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AnalyticsDelivery_event_fkey" FOREIGN KEY ("analyticsEventId") REFERENCES "AnalyticsEvent"("id") ON DELETE CASCADE,
  CONSTRAINT "AnalyticsDelivery_status_check" CHECK ("status" IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'DEAD', 'DISABLED')),
  CONSTRAINT "AnalyticsDelivery_attempts_check" CHECK ("attempts" >= 0)
);
CREATE UNIQUE INDEX "AnalyticsDelivery_event_provider_key" ON "AnalyticsDelivery"("analyticsEventId", "provider");
CREATE INDEX "AnalyticsDelivery_ready_idx" ON "AnalyticsDelivery"("provider", "status", "nextAttemptAt", "createdAt");
CREATE INDEX "AnalyticsDelivery_stale_idx" ON "AnalyticsDelivery"("lockedAt") WHERE "status" = 'PROCESSING';

CREATE TABLE "AnalyticsExperiment" (
  "key" VARCHAR(96) NOT NULL,
  "version" INTEGER NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'DISABLED',
  "rolloutBasisPoints" INTEGER NOT NULL DEFAULT 0,
  "variants" JSONB NOT NULL,
  "salt" VARCHAR(128) NOT NULL,
  "startsAt" TIMESTAMPTZ,
  "endsAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsExperiment_pkey" PRIMARY KEY ("key", "version"),
  CONSTRAINT "AnalyticsExperiment_status_check" CHECK ("status" IN ('ACTIVE', 'DISABLED')),
  CONSTRAINT "AnalyticsExperiment_rollout_check" CHECK ("rolloutBasisPoints" BETWEEN 0 AND 10000),
  CONSTRAINT "AnalyticsExperiment_dates_check" CHECK ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" > "startsAt")
);
CREATE INDEX "AnalyticsExperiment_active_idx" ON "AnalyticsExperiment"("key", "status", "version" DESC);

CREATE TABLE "AnalyticsExperimentAssignment" (
  "id" UUID NOT NULL,
  "experimentKey" VARCHAR(96) NOT NULL,
  "experimentVersion" INTEGER NOT NULL,
  "subjectType" VARCHAR(16) NOT NULL,
  "subjectId" UUID NOT NULL,
  "variant" VARCHAR(64) NOT NULL,
  "assignedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsExperimentAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AnalyticsExperimentAssignment_experiment_fkey"
    FOREIGN KEY ("experimentKey", "experimentVersion") REFERENCES "AnalyticsExperiment"("key", "version") ON DELETE CASCADE,
  CONSTRAINT "AnalyticsExperimentAssignment_subject_check" CHECK ("subjectType" IN ('ACCOUNT', 'CHARACTER'))
);
CREATE UNIQUE INDEX "AnalyticsExperimentAssignment_identity_key"
  ON "AnalyticsExperimentAssignment"("experimentKey", "experimentVersion", "subjectType", "subjectId");
CREATE INDEX "AnalyticsExperimentAssignment_subject_idx"
  ON "AnalyticsExperimentAssignment"("subjectType", "subjectId", "assignedAt");

CREATE OR REPLACE FUNCTION "append_analytics_source_event"(
  event_type TEXT,
  operation_id TEXT,
  actor_character_id UUID,
  realm_id UUID,
  map_id UUID,
  payload JSONB,
  happened_at TIMESTAMPTZ
) RETURNS UUID AS $$
DECLARE
  event_id UUID;
BEGIN
  INSERT INTO "DomainEvent" (
    "id", "deduplicationKey", "operationId", "type", "schemaVersion",
    "actorCharacterId", "realmId", "mapId", "payload", "occurredAt", "createdAt"
  ) VALUES (
    gen_random_uuid(), event_type || ':' || operation_id, operation_id, event_type, 1,
    actor_character_id, realm_id, map_id, payload, happened_at, NOW()
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
  RETURN event_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "emit_account_registered_event"()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM "append_analytics_source_event"(
    'AccountRegistered', 'account-registered:' || NEW."id"::text, NULL, NULL, NULL,
    jsonb_build_object('accountId', NEW."id"::text), NEW."createdAt"
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "User_account_registered_event_trigger"
AFTER INSERT ON "User" FOR EACH ROW EXECUTE FUNCTION "emit_account_registered_event"();

CREATE OR REPLACE FUNCTION "emit_character_created_event"()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM "append_analytics_source_event"(
    'CharacterCreated', 'character-created:' || NEW."id"::text, NEW."id", NEW."realmId", NEW."mapId",
    jsonb_build_object(
      'accountId', NEW."userId"::text,
      'characterId', NEW."id"::text,
      'characterClass', NEW."class"::text,
      'level', NEW."level"
    ), NEW."createdAt"
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Character_character_created_event_trigger"
AFTER INSERT ON "Character" FOR EACH ROW EXECUTE FUNCTION "emit_character_created_event"();

CREATE OR REPLACE FUNCTION "emit_guild_joined_event"()
RETURNS TRIGGER AS $$
DECLARE
  character_row RECORD;
BEGIN
  SELECT "userId", "realmId", "mapId" INTO character_row
  FROM "Character" WHERE "id" = NEW."characterId";
  PERFORM "append_analytics_source_event"(
    'GuildJoined', 'guild-joined:' || NEW."guildId"::text || ':' || NEW."characterId"::text,
    NEW."characterId", character_row."realmId", character_row."mapId",
    jsonb_build_object(
      'accountId', character_row."userId"::text,
      'characterId', NEW."characterId"::text,
      'guildId', NEW."guildId"::text,
      'role', NEW."role"::text
    ), NEW."joinedAt"
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "GuildMember_guild_joined_event_trigger"
AFTER INSERT ON "GuildMember" FOR EACH ROW EXECUTE FUNCTION "emit_guild_joined_event"();

CREATE OR REPLACE FUNCTION "emit_currency_changed_event"()
RETURNS TRIGGER AS $$
DECLARE
  character_row RECORD;
  signed_amount INTEGER;
BEGIN
  SELECT "userId", "realmId", "mapId" INTO character_row
  FROM "Character" WHERE "id" = NEW."characterId";
  signed_amount := CASE WHEN NEW."direction" = 'CREDIT' THEN NEW."amount" ELSE -NEW."amount" END;
  PERFORM "append_analytics_source_event"(
    'CurrencyChanged', 'currency:' || NEW."characterId"::text || ':' || NEW."operationId",
    NEW."characterId", character_row."realmId", character_row."mapId",
    jsonb_build_object(
      'accountId', character_row."userId"::text,
      'characterId', NEW."characterId"::text,
      'currency', NEW."currency"::text,
      'direction', NEW."direction"::text,
      'amount', NEW."amount",
      'signedAmount', signed_amount,
      'balanceAfter', NEW."balanceAfter",
      'reason', NEW."reason",
      'ledgerOperationId', NEW."operationId",
      'metadata', NEW."metadata"
    ), NEW."createdAt"
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "CharacterCurrencyLedger_currency_changed_event_trigger"
AFTER INSERT ON "CharacterCurrencyLedger" FOR EACH ROW EXECUTE FUNCTION "emit_currency_changed_event"();

INSERT INTO "DomainEvent" (
  "id", "deduplicationKey", "operationId", "type", "schemaVersion", "payload", "occurredAt", "createdAt"
)
SELECT gen_random_uuid(), 'AccountRegistered:account-registered:' || "id"::text,
  'account-registered:' || "id"::text, 'AccountRegistered', 1,
  jsonb_build_object('accountId', "id"::text, 'migration', 'legacy-backfill'), "createdAt", NOW()
FROM "User" ON CONFLICT DO NOTHING;

INSERT INTO "DomainEvent" (
  "id", "deduplicationKey", "operationId", "type", "schemaVersion",
  "actorCharacterId", "realmId", "mapId", "payload", "occurredAt", "createdAt"
)
SELECT gen_random_uuid(), 'CharacterCreated:character-created:' || "id"::text,
  'character-created:' || "id"::text, 'CharacterCreated', 1, "id", "realmId", "mapId",
  jsonb_build_object(
    'accountId', "userId"::text, 'characterId', "id"::text,
    'characterClass', "class"::text, 'level', "level", 'migration', 'legacy-backfill'
  ), "createdAt", NOW()
FROM "Character" ON CONFLICT DO NOTHING;

INSERT INTO "DomainEvent" (
  "id", "deduplicationKey", "operationId", "type", "schemaVersion",
  "actorCharacterId", "realmId", "mapId", "payload", "occurredAt", "createdAt"
)
SELECT gen_random_uuid(), 'GuildJoined:guild-joined:' || member."guildId"::text || ':' || member."characterId"::text,
  'guild-joined:' || member."guildId"::text || ':' || member."characterId"::text,
  'GuildJoined', 1, member."characterId", character."realmId", character."mapId",
  jsonb_build_object(
    'accountId', character."userId"::text, 'characterId', member."characterId"::text,
    'guildId', member."guildId"::text, 'role', member."role"::text, 'migration', 'legacy-backfill'
  ), member."joinedAt", NOW()
FROM "GuildMember" member JOIN "Character" character ON character."id" = member."characterId"
ON CONFLICT DO NOTHING;

INSERT INTO "DomainEvent" (
  "id", "deduplicationKey", "operationId", "type", "schemaVersion",
  "actorCharacterId", "realmId", "mapId", "payload", "occurredAt", "createdAt"
)
SELECT gen_random_uuid(), 'CurrencyChanged:currency:' || ledger."characterId"::text || ':' || ledger."operationId",
  'currency:' || ledger."characterId"::text || ':' || ledger."operationId",
  'CurrencyChanged', 1, ledger."characterId", character."realmId", character."mapId",
  jsonb_build_object(
    'accountId', character."userId"::text, 'characterId', ledger."characterId"::text,
    'currency', ledger."currency"::text, 'direction', ledger."direction"::text,
    'amount', ledger."amount",
    'signedAmount', CASE WHEN ledger."direction" = 'CREDIT' THEN ledger."amount" ELSE -ledger."amount" END,
    'balanceAfter', ledger."balanceAfter", 'reason', ledger."reason",
    'ledgerOperationId', ledger."operationId", 'metadata', ledger."metadata",
    'migration', 'legacy-backfill'
  ), ledger."createdAt", NOW()
FROM "CharacterCurrencyLedger" ledger
JOIN "Character" character ON character."id" = ledger."characterId"
ON CONFLICT DO NOTHING;

INSERT INTO "EventOutbox" ("id", "eventId", "status", "nextAttemptAt", "createdAt", "updatedAt")
SELECT gen_random_uuid(), event."id", 'PENDING', NOW(), NOW(), NOW()
FROM "DomainEvent" event
LEFT JOIN "EventOutbox" outbox ON outbox."eventId" = event."id"
WHERE outbox."eventId" IS NULL
  AND event."type" IN ('AccountRegistered', 'CharacterCreated', 'GuildJoined', 'CurrencyChanged')
ON CONFLICT ("eventId") DO NOTHING;

CREATE OR REPLACE VIEW "AnalyticsFunnelDaily" AS
WITH first_events AS (
  SELECT "accountId", "eventName", MIN("occurredAt") AS first_at
  FROM "AnalyticsEvent"
  WHERE "accountId" IS NOT NULL
    AND "eventName" IN (
      'account.registered', 'character.created', 'region.entered', 'combat.started',
      'quest.choice', 'group.joined', 'session.started'
    )
  GROUP BY "accountId", "eventName"
), cohorts AS (
  SELECT "accountId", MIN(first_at)::date AS cohort_date
  FROM first_events WHERE "eventName" = 'account.registered' GROUP BY "accountId"
)
SELECT cohorts.cohort_date AS "cohortDate",
  COUNT(*)::bigint AS "accounts",
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM first_events f WHERE f."accountId" = cohorts."accountId" AND f."eventName" = 'character.created'))::bigint AS "createdCharacter",
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM first_events f WHERE f."accountId" = cohorts."accountId" AND f."eventName" = 'region.entered'))::bigint AS "enteredWorld",
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM first_events f WHERE f."accountId" = cohorts."accountId" AND f."eventName" = 'combat.started'))::bigint AS "startedCombat",
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM first_events f WHERE f."accountId" = cohorts."accountId" AND f."eventName" = 'quest.choice'))::bigint AS "madeChoice",
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM first_events f WHERE f."accountId" = cohorts."accountId" AND f."eventName" = 'group.joined'))::bigint AS "joinedGroup"
FROM cohorts GROUP BY cohorts.cohort_date ORDER BY cohorts.cohort_date;

CREATE OR REPLACE VIEW "AnalyticsRetentionDaily" AS
WITH sessions AS (
  SELECT "accountId", "occurredAt"::date AS active_date
  FROM "AnalyticsEvent"
  WHERE "eventName" = 'session.started' AND "accountId" IS NOT NULL
  GROUP BY "accountId", "occurredAt"::date
), cohorts AS (
  SELECT "accountId", MIN(active_date) AS cohort_date FROM sessions GROUP BY "accountId"
)
SELECT cohort_date AS "cohortDate", COUNT(*)::bigint AS "accounts",
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM sessions s WHERE s."accountId" = cohorts."accountId" AND s.active_date = cohorts.cohort_date + 1))::bigint AS "d1",
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM sessions s WHERE s."accountId" = cohorts."accountId" AND s.active_date = cohorts.cohort_date + 7))::bigint AS "d7",
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM sessions s WHERE s."accountId" = cohorts."accountId" AND s.active_date = cohorts.cohort_date + 30))::bigint AS "d30"
FROM cohorts GROUP BY cohort_date ORDER BY cohort_date;

CREATE OR REPLACE VIEW "AnalyticsEconomyDaily" AS
WITH ledger AS (
  SELECT "createdAt"::date AS day, "currency"::text AS currency,
    SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount" ELSE -"amount" END)::bigint AS ledger_net,
    SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount" ELSE 0 END)::bigint AS sources,
    SUM(CASE WHEN "direction" = 'DEBIT' THEN "amount" ELSE 0 END)::bigint AS sinks
  FROM "CharacterCurrencyLedger" GROUP BY "createdAt"::date, "currency"::text
), analytics AS (
  SELECT "occurredAt"::date AS day, "properties"->>'currency' AS currency,
    SUM(COALESCE(("properties"->>'signedAmount')::bigint, 0))::bigint AS analytics_net
  FROM "AnalyticsEvent" WHERE "eventName" = 'economy.currency_changed'
  GROUP BY "occurredAt"::date, "properties"->>'currency'
)
SELECT COALESCE(ledger.day, analytics.day) AS day,
  COALESCE(ledger.currency, analytics.currency) AS currency,
  COALESCE(ledger.sources, 0) AS sources,
  COALESCE(ledger.sinks, 0) AS sinks,
  COALESCE(ledger.ledger_net, 0) AS "ledgerNet",
  COALESCE(analytics.analytics_net, 0) AS "analyticsNet",
  COALESCE(analytics.analytics_net, 0) - COALESCE(ledger.ledger_net, 0) AS gap
FROM ledger FULL JOIN analytics USING (day, currency)
ORDER BY day, currency;

CREATE OR REPLACE VIEW "AnalyticsCombatHealthDaily" AS
WITH finished AS (
  SELECT "occurredAt"::date AS day,
    COUNT(*)::bigint AS combats,
    AVG(COALESCE(("properties"->>'durationMs')::numeric, 0)) AS avg_duration_ms,
    AVG(COALESCE(("properties"->>'turns')::numeric, 0)) AS avg_turns,
    COUNT(*) FILTER (WHERE "properties"->>'finishReason' IN ('FORFEIT', 'DISCONNECTED'))::bigint AS abandoned,
    COUNT(*) FILTER (WHERE "properties"->>'finishReason' IN ('REQUEST_EXPIRED', 'CANCELLED'))::bigint AS timeouts,
    COUNT(*) FILTER (WHERE "properties"->>'finishReason' = 'SERVER_SHUTDOWN')::bigint AS shutdowns,
    AVG(COALESCE(("properties"->>'participantCount')::numeric, 0)) AS avg_participants
  FROM "AnalyticsEvent" WHERE "eventName" = 'combat.finished' GROUP BY "occurredAt"::date
), actions AS (
  SELECT "occurredAt"::date AS day,
    COUNT(*)::bigint AS actions,
    COUNT(*) FILTER (WHERE "properties"->>'action' = 'SKILL')::bigint AS skill_actions,
    COUNT(DISTINCT NULLIF("properties"->>'skillKey', ''))::bigint AS distinct_skills
  FROM "AnalyticsEvent" WHERE "eventName" = 'combat.action' GROUP BY "occurredAt"::date
), disconnects AS (
  SELECT "occurredAt"::date AS day, COUNT(*)::bigint AS disconnects
  FROM "AnalyticsEvent" WHERE "eventName" = 'combat.disconnected' GROUP BY "occurredAt"::date
)
SELECT COALESCE(finished.day, actions.day, disconnects.day) AS day,
  COALESCE(finished.combats, 0) AS combats,
  COALESCE(finished.avg_duration_ms, 0) AS "averageDurationMs",
  COALESCE(finished.avg_turns, 0) AS "averageTurns",
  COALESCE(finished.avg_participants, 0) AS "averageParticipants",
  COALESCE(finished.abandoned, 0) AS abandoned,
  COALESCE(finished.timeouts, 0) AS timeouts,
  COALESCE(finished.shutdowns, 0) AS shutdowns,
  COALESCE(disconnects.disconnects, 0) AS disconnects,
  COALESCE(actions.actions, 0) AS actions,
  COALESCE(actions.skill_actions, 0) AS "skillActions",
  COALESCE(actions.distinct_skills, 0) AS "distinctSkills"
FROM finished FULL JOIN actions USING (day) FULL JOIN disconnects USING (day)
ORDER BY day;

CREATE OR REPLACE VIEW "AnalyticsQueueHealth" AS
SELECT "provider", "status", COUNT(*)::bigint AS count,
  MIN("createdAt") AS "oldestCreatedAt", MAX("attempts") AS "maximumAttempts"
FROM "AnalyticsDelivery" GROUP BY "provider", "status" ORDER BY "provider", "status";

CREATE OR REPLACE VIEW "AnalyticsAnomalies" AS
SELECT 'ECONOMY_RECONCILIATION_GAP'::text AS kind, day::timestamptz AS "detectedAt",
  jsonb_build_object('currency', currency, 'gap', gap, 'ledgerNet', "ledgerNet", 'analyticsNet', "analyticsNet") AS details
FROM "AnalyticsEconomyDaily" WHERE gap <> 0
UNION ALL
SELECT 'DEAD_DELIVERY', MIN("createdAt"),
  jsonb_build_object('provider', "provider", 'count', COUNT(*), 'maximumAttempts', MAX("attempts"))
FROM "AnalyticsDelivery" WHERE "status" = 'DEAD' GROUP BY "provider";
