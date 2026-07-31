-- Reference analytics model for the versioned TelemetryEnvelope.
-- Expected warehouse table:
-- analytics_events(
--   event_id text primary key,
--   name text not null,
--   schema_version integer not null,
--   occurred_at timestamptz not null,
--   server_version text not null,
--   session_id text,
--   user_id text,
--   character_id text,
--   realm_id text,
--   client_version text,
--   payload jsonb not null,
--   is_test_account boolean not null default false
-- )

-- 1. First-session funnel by server version.
WITH first_event AS (
  SELECT
    user_id,
    server_version,
    MIN(occurred_at) FILTER (WHERE name = 'account_registered') AS registered_at,
    MIN(occurred_at) FILTER (WHERE name = 'character_created') AS character_created_at,
    MIN(occurred_at) FILTER (WHERE name = 'world_entered') AS world_entered_at,
    MIN(occurred_at) FILTER (WHERE name = 'tutorial_step_completed') AS tutorial_step_at
  FROM analytics_events
  WHERE NOT is_test_account
    AND user_id IS NOT NULL
  GROUP BY user_id, server_version
)
SELECT
  server_version,
  COUNT(*) FILTER (WHERE registered_at IS NOT NULL) AS registered,
  COUNT(*) FILTER (WHERE character_created_at IS NOT NULL) AS character_created,
  COUNT(*) FILTER (WHERE world_entered_at IS NOT NULL) AS world_entered,
  COUNT(*) FILTER (WHERE tutorial_step_at IS NOT NULL) AS tutorial_progressed,
  ROUND(100.0 * COUNT(*) FILTER (WHERE character_created_at IS NOT NULL)
    / NULLIF(COUNT(*) FILTER (WHERE registered_at IS NOT NULL), 0), 2) AS registration_to_character_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE world_entered_at IS NOT NULL)
    / NULLIF(COUNT(*) FILTER (WHERE character_created_at IS NOT NULL), 0), 2) AS character_to_world_pct,
  PERCENTILE_CONT(0.5) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (world_entered_at - registered_at))
  ) FILTER (WHERE registered_at IS NOT NULL AND world_entered_at IS NOT NULL) AS median_seconds_to_world
FROM first_event
GROUP BY server_version
ORDER BY server_version;

-- 2. D1 and D7 retention based on authoritative world entry.
WITH cohorts AS (
  SELECT
    user_id,
    MIN(occurred_at::date) AS cohort_date
  FROM analytics_events
  WHERE name = 'world_entered'
    AND NOT is_test_account
    AND user_id IS NOT NULL
  GROUP BY user_id
),
returns AS (
  SELECT DISTINCT user_id, occurred_at::date AS activity_date
  FROM analytics_events
  WHERE name = 'world_entered'
    AND NOT is_test_account
    AND user_id IS NOT NULL
)
SELECT
  cohorts.cohort_date,
  COUNT(*) AS cohort_size,
  COUNT(*) FILTER (WHERE d1.user_id IS NOT NULL) AS d1_users,
  COUNT(*) FILTER (WHERE d7.user_id IS NOT NULL) AS d7_users,
  ROUND(100.0 * COUNT(*) FILTER (WHERE d1.user_id IS NOT NULL) / NULLIF(COUNT(*), 0), 2) AS d1_pct,
  ROUND(100.0 * COUNT(*) FILTER (WHERE d7.user_id IS NOT NULL) / NULLIF(COUNT(*), 0), 2) AS d7_pct
FROM cohorts
LEFT JOIN returns d1
  ON d1.user_id = cohorts.user_id
 AND d1.activity_date = cohorts.cohort_date + 1
LEFT JOIN returns d7
  ON d7.user_id = cohorts.user_id
 AND d7.activity_date = cohorts.cohort_date + 7
GROUP BY cohorts.cohort_date
ORDER BY cohorts.cohort_date DESC;

-- 3. Session-length distribution.
SELECT
  occurred_at::date AS day,
  COUNT(*) AS sessions,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (payload->>'durationMs')::bigint) AS median_duration_ms,
  PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY (payload->>'durationMs')::bigint) AS p90_duration_ms
FROM analytics_events
WHERE name = 'session_ended'
  AND NOT is_test_account
GROUP BY occurred_at::date
ORDER BY day DESC;

-- 4. Combat duration, timeout rate and outcomes.
SELECT
  occurred_at::date AS day,
  server_version,
  payload->>'mode' AS mode,
  COUNT(*) AS combats,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (payload->>'durationMs')::bigint) AS median_duration_ms,
  PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY (payload->>'durationMs')::bigint) AS p90_duration_ms,
  SUM((payload->>'timeoutCount')::bigint) AS timed_out_turns,
  ROUND(AVG((payload->>'timeoutCount')::numeric), 2) AS average_timeouts_per_combat,
  payload->>'finishReason' AS finish_reason
FROM analytics_events
WHERE name = 'combat_finished'
  AND NOT is_test_account
GROUP BY occurred_at::date, server_version, payload->>'mode', payload->>'finishReason'
ORDER BY day DESC, server_version, mode;

-- 5. Quest completion time and abandonment inputs.
WITH starts AS (
  SELECT user_id, character_id, payload->>'questKey' AS quest_key, MIN(occurred_at) AS started_at
  FROM analytics_events
  WHERE name = 'quest_started' AND NOT is_test_account
  GROUP BY user_id, character_id, payload->>'questKey'
),
completions AS (
  SELECT user_id, character_id, payload->>'questKey' AS quest_key, MIN(occurred_at) AS completed_at
  FROM analytics_events
  WHERE name = 'quest_completed' AND NOT is_test_account
  GROUP BY user_id, character_id, payload->>'questKey'
)
SELECT
  starts.quest_key,
  COUNT(*) AS starts,
  COUNT(completions.completed_at) AS completions,
  ROUND(100.0 * COUNT(completions.completed_at) / NULLIF(COUNT(*), 0), 2) AS completion_pct,
  PERCENTILE_CONT(0.5) WITHIN GROUP (
    ORDER BY EXTRACT(EPOCH FROM (completions.completed_at - starts.started_at))
  ) FILTER (WHERE completions.completed_at IS NOT NULL) AS median_completion_seconds
FROM starts
LEFT JOIN completions USING (user_id, character_id, quest_key)
GROUP BY starts.quest_key
ORDER BY starts.quest_key;

-- 6. Silver sources and sinks. Balance levels should be joined from the authoritative ledger snapshot.
SELECT
  occurred_at::date AS day,
  payload->>'direction' AS direction,
  payload->>'reason' AS reason,
  COUNT(*) AS operations,
  SUM((payload->>'amount')::bigint) AS amount
FROM analytics_events
WHERE name = 'currency_changed'
  AND payload->>'currency' = 'SILVER'
  AND NOT is_test_account
GROUP BY occurred_at::date, payload->>'direction', payload->>'reason'
ORDER BY day DESC, direction, reason;

-- 7. Item inflow by source.
SELECT
  occurred_at::date AS day,
  payload->>'source' AS source,
  payload->>'itemKey' AS item_key,
  SUM((payload->>'quantity')::bigint) AS quantity
FROM analytics_events
WHERE name = 'item_received'
  AND NOT is_test_account
GROUP BY occurred_at::date, payload->>'source', payload->>'itemKey'
ORDER BY day DESC, source, item_key;
