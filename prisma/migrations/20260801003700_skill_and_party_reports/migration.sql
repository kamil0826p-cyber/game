CREATE OR REPLACE VIEW "AnalyticsSkillPerformanceDaily" AS
WITH result_rows AS (
  SELECT
    event."eventId",
    event."occurredAt"::date AS day,
    event."properties"->>'skillKey' AS skill_key,
    result.value AS result
  FROM "AnalyticsEvent" event
  CROSS JOIN LATERAL jsonb_array_elements(
    COALESCE(event."properties"->'results', '[]'::jsonb)
  ) AS result(value)
  WHERE event."eventName" = 'combat.action'
    AND event."properties"->>'action' = 'SKILL'
    AND NULLIF(event."properties"->>'skillKey', '') IS NOT NULL
)
SELECT
  day,
  skill_key AS "skillKey",
  COUNT(DISTINCT "eventId")::bigint AS uses,
  SUM(GREATEST(0, -COALESCE((result->>'hpDelta')::bigint, 0)))::bigint AS damage,
  SUM(GREATEST(0, COALESCE((result->>'hpDelta')::bigint, 0)))::bigint AS healing,
  SUM(GREATEST(0, COALESCE((result->>'shieldAbsorbed')::bigint, 0)))::bigint AS "shieldAbsorbed",
  COUNT(*) FILTER (WHERE COALESCE((result->>'dodged')::boolean, FALSE))::bigint AS dodges,
  SUM(jsonb_array_length(COALESCE(result->'statusesApplied', '[]'::jsonb)))::bigint AS "statusesApplied",
  AVG(GREATEST(0, -COALESCE((result->>'hpDelta')::numeric, 0))) AS "averageDamagePerTarget",
  AVG(GREATEST(0, COALESCE((result->>'hpDelta')::numeric, 0))) AS "averageHealingPerTarget"
FROM result_rows
GROUP BY day, skill_key
ORDER BY day, skill_key;

CREATE OR REPLACE VIEW "AnalyticsCombatPartySizeDaily" AS
SELECT
  "occurredAt"::date AS day,
  COALESCE("properties"->>'mode', 'UNKNOWN') AS mode,
  COALESCE(("properties"->>'participantCount')::integer, 0) AS "participantCount",
  COUNT(*)::bigint AS combats,
  AVG(COALESCE(("properties"->>'durationMs')::numeric, 0)) AS "averageDurationMs",
  AVG(COALESCE(("properties"->>'turns')::numeric, 0)) AS "averageTurns",
  COUNT(*) FILTER (WHERE "properties"->>'finishReason' IN ('FORFEIT', 'DISCONNECTED'))::bigint AS abandoned,
  COUNT(*) FILTER (WHERE "properties"->>'finishReason' IN ('REQUEST_EXPIRED', 'CANCELLED'))::bigint AS timeouts
FROM "AnalyticsEvent"
WHERE "eventName" = 'combat.finished'
GROUP BY
  "occurredAt"::date,
  COALESCE("properties"->>'mode', 'UNKNOWN'),
  COALESCE(("properties"->>'participantCount')::integer, 0)
ORDER BY day, mode, "participantCount";
