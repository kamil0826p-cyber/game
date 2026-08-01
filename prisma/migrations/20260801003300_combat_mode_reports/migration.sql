CREATE OR REPLACE VIEW "AnalyticsCombatHealthByModeDaily" AS
WITH resolved_raw AS (
  SELECT
    "occurredAt"::date AS day,
    "properties"->>'combatId' AS combat_id,
    COALESCE("properties"->>'mode', 'UNKNOWN') AS mode,
    COALESCE("properties"->>'zoneType', 'UNKNOWN') AS zone_type,
    COALESCE(NULLIF("properties"->>'difficultyLevel', '')::integer, 0) AS difficulty_level,
    COALESCE(("properties"->>'durationMs')::numeric, 0) AS duration_ms,
    COALESCE(("properties"->>'turns')::numeric, 0) AS turns,
    COALESCE(("properties"->>'participantCount')::numeric, 0) AS participants,
    COALESCE("properties"->>'finishReason', 'UNKNOWN') AS finish_reason
  FROM "AnalyticsEvent"
  WHERE "eventName" = 'combat.finished'
), finished AS (
  SELECT
    day,
    mode,
    zone_type,
    difficulty_level,
    COUNT(*)::bigint AS combats,
    AVG(duration_ms) AS average_duration_ms,
    AVG(turns) AS average_turns,
    AVG(participants) AS average_participants,
    COUNT(*) FILTER (WHERE finish_reason IN ('FORFEIT', 'DISCONNECTED'))::bigint AS abandoned,
    COUNT(*) FILTER (WHERE finish_reason IN ('REQUEST_EXPIRED', 'CANCELLED'))::bigint AS timeouts,
    COUNT(*) FILTER (WHERE finish_reason = 'SERVER_SHUTDOWN')::bigint AS shutdowns
  FROM resolved_raw
  GROUP BY day, mode, zone_type, difficulty_level
), actions AS (
  SELECT
    resolved.day,
    resolved.mode,
    resolved.zone_type,
    resolved.difficulty_level,
    COUNT(*)::bigint AS actions,
    COUNT(*) FILTER (WHERE event."properties"->>'action' = 'SKILL')::bigint AS skill_actions,
    COUNT(DISTINCT NULLIF(event."properties"->>'skillKey', ''))::bigint AS distinct_skills
  FROM "AnalyticsEvent" event
  JOIN resolved_raw resolved
    ON resolved.combat_id = event."properties"->>'combatId'
  WHERE event."eventName" = 'combat.action'
  GROUP BY resolved.day, resolved.mode, resolved.zone_type, resolved.difficulty_level
), disconnects AS (
  SELECT
    resolved.day,
    resolved.mode,
    resolved.zone_type,
    resolved.difficulty_level,
    COUNT(*)::bigint AS disconnects
  FROM "AnalyticsEvent" event
  JOIN resolved_raw resolved
    ON resolved.combat_id = event."properties"->>'combatId'
  WHERE event."eventName" = 'combat.disconnected'
  GROUP BY resolved.day, resolved.mode, resolved.zone_type, resolved.difficulty_level
)
SELECT
  finished.day,
  finished.mode,
  finished.zone_type AS "zoneType",
  finished.difficulty_level AS "difficultyLevel",
  finished.combats,
  finished.average_duration_ms AS "averageDurationMs",
  finished.average_turns AS "averageTurns",
  finished.average_participants AS "averageParticipants",
  finished.abandoned,
  finished.timeouts,
  finished.shutdowns,
  COALESCE(disconnects.disconnects, 0) AS disconnects,
  COALESCE(actions.actions, 0) AS actions,
  COALESCE(actions.skill_actions, 0) AS "skillActions",
  COALESCE(actions.distinct_skills, 0) AS "distinctSkills"
FROM finished
LEFT JOIN actions
  ON actions.day = finished.day
  AND actions.mode = finished.mode
  AND actions.zone_type = finished.zone_type
  AND actions.difficulty_level = finished.difficulty_level
LEFT JOIN disconnects
  ON disconnects.day = finished.day
  AND disconnects.mode = finished.mode
  AND disconnects.zone_type = finished.zone_type
  AND disconnects.difficulty_level = finished.difficulty_level
ORDER BY finished.day, finished.mode, finished.zone_type, finished.difficulty_level;
