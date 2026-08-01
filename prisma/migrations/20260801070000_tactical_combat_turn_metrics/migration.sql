DROP VIEW IF EXISTS "AnalyticsCombatTurnTimingDaily";

CREATE VIEW "AnalyticsCombatTurnTimingDaily" AS
SELECT
  DATE_TRUNC('day', "occurredAt")::date AS "day",
  COALESCE("payload" ->> 'mode', 'UNKNOWN') AS "mode",
  COALESCE("payload" ->> 'action', 'UNKNOWN') AS "action",
  COUNT(*)::bigint AS "acceptedActions",
  COUNT(*) FILTER (WHERE COALESCE(("payload" ->> 'timedOut')::boolean, false))::bigint AS "timedOutActions",
  ROUND(
    10000.0 * COUNT(*) FILTER (WHERE COALESCE(("payload" ->> 'timedOut')::boolean, false)) /
      NULLIF(COUNT(*), 0)
  )::integer AS "timeoutRateBasisPoints",
  PERCENTILE_CONT(0.5) WITHIN GROUP (
    ORDER BY GREATEST(0, COALESCE(("payload" ->> 'decisionTimeMs')::numeric, 0))
  )::numeric(14, 2) AS "medianDecisionMs",
  PERCENTILE_CONT(0.95) WITHIN GROUP (
    ORDER BY GREATEST(0, COALESCE(("payload" ->> 'decisionTimeMs')::numeric, 0))
  )::numeric(14, 2) AS "p95DecisionMs",
  COUNT(*) FILTER (
    WHERE COALESCE(("payload" -> 'results' -> 0 ->> 'reactionChangedOutcome')::boolean, false)
  )::bigint AS "outcomeChangingReactions"
FROM "DomainEvent"
WHERE "type" = 'CombatActionAccepted'
  AND jsonb_typeof("payload") = 'object'
GROUP BY 1, 2, 3;

COMMENT ON VIEW "AnalyticsCombatTurnTimingDaily" IS
  'Server-authoritative median/P95 combat decision time, timeout rate and outcome-changing reactions.';
