CREATE OR REPLACE VIEW "AnalyticsSessionHealthDaily" AS
WITH starts AS (
  SELECT
    "accountId",
    "sessionId",
    "occurredAt" AS started_at
  FROM "AnalyticsEvent"
  WHERE "eventName" = 'session.started'
    AND "accountId" IS NOT NULL
    AND "sessionId" IS NOT NULL
), ends AS (
  SELECT
    "sessionId",
    MAX(COALESCE(("properties"->>'durationMs')::numeric, 0)) AS duration_ms
  FROM "AnalyticsEvent"
  WHERE "eventName" = 'session.ended'
    AND "sessionId" IS NOT NULL
  GROUP BY "sessionId"
), ordered AS (
  SELECT
    starts."accountId",
    starts."sessionId",
    starts.started_at,
    ends.duration_ms,
    LAG(starts.started_at) OVER (
      PARTITION BY starts."accountId" ORDER BY starts.started_at
    ) AS previous_started_at
  FROM starts
  LEFT JOIN ends USING ("sessionId")
)
SELECT
  started_at::date AS day,
  COUNT(*)::bigint AS sessions,
  COUNT(DISTINCT "accountId")::bigint AS "activeAccounts",
  COUNT(*)::numeric / NULLIF(COUNT(DISTINCT "accountId"), 0) AS "sessionsPerAccount",
  AVG(duration_ms) FILTER (WHERE duration_ms IS NOT NULL) AS "averageDurationMs",
  percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)
    FILTER (WHERE duration_ms IS NOT NULL) AS "medianDurationMs",
  percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)
    FILTER (WHERE duration_ms IS NOT NULL) AS "p95DurationMs",
  AVG(EXTRACT(EPOCH FROM (started_at - previous_started_at)) * 1000)
    FILTER (WHERE previous_started_at IS NOT NULL) AS "averageReturnGapMs"
FROM ordered
GROUP BY started_at::date
ORDER BY day;

CREATE OR REPLACE VIEW "AnalyticsCurrencyInflationDaily" AS
WITH daily AS (
  SELECT
    "createdAt"::date AS day,
    "currency"::text AS currency,
    SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount" ELSE 0 END)::bigint AS sources,
    SUM(CASE WHEN "direction" = 'DEBIT' THEN "amount" ELSE 0 END)::bigint AS sinks,
    SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount" ELSE -"amount" END)::bigint AS net
  FROM "CharacterCurrencyLedger"
  GROUP BY "createdAt"::date, "currency"::text
), cumulative AS (
  SELECT
    day,
    currency,
    sources,
    sinks,
    net,
    SUM(net) OVER (PARTITION BY currency ORDER BY day) AS cumulative_net
  FROM daily
)
SELECT
  day,
  currency,
  sources,
  sinks,
  net,
  cumulative_net AS "cumulativeNet",
  cumulative_net - LAG(cumulative_net) OVER (PARTITION BY currency ORDER BY day) AS "changeFromPreviousDay",
  CASE
    WHEN ABS(LAG(cumulative_net) OVER (PARTITION BY currency ORDER BY day)) > 0
      THEN 100.0 * net / ABS(LAG(cumulative_net) OVER (PARTITION BY currency ORDER BY day))
    ELSE NULL
  END AS "dailyGrowthPercent"
FROM cumulative
ORDER BY day, currency;

CREATE OR REPLACE VIEW "AnalyticsCurrencySupplyCurrent" AS
SELECT 'SILVER'::text AS currency, SUM("silver")::bigint AS supply, COUNT(*)::bigint AS characters
FROM "Character"
UNION ALL
SELECT 'GOLD'::text AS currency, SUM("gold")::bigint AS supply, COUNT(*)::bigint AS characters
FROM "Character";

CREATE OR REPLACE VIEW "AnalyticsItemPrices" AS
SELECT
  "key" AS "itemKey",
  "name",
  CASE
    WHEN COALESCE("metadata"->>'buyPriceSilver', '') ~ '^[0-9]+$'
      THEN ("metadata"->>'buyPriceSilver')::bigint
    ELSE NULL
  END AS "buyPriceSilver",
  CASE
    WHEN COALESCE("metadata"->>'sellPriceSilver', '') ~ '^[0-9]+$'
      THEN ("metadata"->>'sellPriceSilver')::bigint
    ELSE NULL
  END AS "sellPriceSilver",
  CASE
    WHEN COALESCE("metadata"->>'buyPriceSilver', '') ~ '^[0-9]+$'
      AND COALESCE("metadata"->>'sellPriceSilver', '') ~ '^[0-9]+$'
      AND ("metadata"->>'buyPriceSilver')::numeric > 0
      THEN ("metadata"->>'sellPriceSilver')::numeric /
        ("metadata"->>'buyPriceSilver')::numeric
    ELSE NULL
  END AS "sellToBuyRatio"
FROM "ItemDefinition"
ORDER BY "key";

CREATE OR REPLACE VIEW "AnalyticsTradeDaily" AS
WITH trades AS (
  SELECT
    event."eventId",
    event."occurredAt"::date AS day,
    participant.value AS participant
  FROM "AnalyticsEvent" event
  CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(event."properties"->'participants', '[]'::jsonb)
  ) AS participant(value)
  WHERE event."eventName" = 'trade.completed'
)
SELECT
  day,
  COUNT(DISTINCT "eventId")::bigint AS trades,
  COUNT(*)::bigint AS participants,
  SUM(COALESCE((participant->>'silverSent')::bigint, 0))::bigint AS "silverVolume",
  AVG(COALESCE((participant->>'silverSent')::numeric, 0)) AS "averageSilverSentPerParticipant"
FROM trades
GROUP BY day
ORDER BY day;

CREATE OR REPLACE VIEW "AnalyticsSkippedLootDaily" AS
SELECT
  event."occurredAt"::date AS day,
  loot.value->>'itemKey' AS "itemKey",
  SUM(COALESCE((loot.value->>'quantity')::bigint, 0))::bigint AS "skippedQuantity",
  COUNT(DISTINCT event."eventId")::bigint AS "affectedDefeats"
FROM "AnalyticsEvent" event
CROSS JOIN LATERAL jsonb_array_elements(
  COALESCE(event."properties"->'skippedLoot', '[]'::jsonb)
) AS loot(value)
WHERE event."eventName" = 'combat.mob_defeated'
GROUP BY event."occurredAt"::date, loot.value->>'itemKey'
ORDER BY day, "itemKey";

CREATE OR REPLACE VIEW "AnalyticsCraftingDaily" AS
SELECT
  "occurredAt"::date AS day,
  "properties"->>'recipeKey' AS "recipeKey",
  SUM(COALESCE(("properties"->>'quantity')::bigint, 0))::bigint AS quantity,
  COUNT(*)::bigint AS crafts,
  COUNT(DISTINCT "characterId")::bigint AS crafters
FROM "AnalyticsEvent"
WHERE "eventName" = 'craft.completed'
GROUP BY "occurredAt"::date, "properties"->>'recipeKey'
ORDER BY day, "recipeKey";
