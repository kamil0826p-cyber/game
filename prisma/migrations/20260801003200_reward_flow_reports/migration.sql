CREATE OR REPLACE VIEW "AnalyticsRewardFlowsDaily" AS
SELECT
  "createdAt"::date AS day,
  "resourceType" AS "resourceType",
  COALESCE("resourceKey", '') AS "resourceKey",
  SUM(CASE WHEN "amount" > 0 THEN "amount" ELSE 0 END)::bigint AS sources,
  SUM(CASE WHEN "amount" < 0 THEN -"amount" ELSE 0 END)::bigint AS sinks,
  SUM("amount")::bigint AS net,
  COUNT(*)::bigint AS entries
FROM "RewardAuditLedger"
GROUP BY "createdAt"::date, "resourceType", COALESCE("resourceKey", '')
ORDER BY day, "resourceType", "resourceKey";
