# Telemetry

## Principles

- Gameplay results are emitted by authoritative backend services after successful operations.
- Every event has an event ID, schema version, server timestamp and server version.
- Telemetry delivery is buffered and never blocks a gameplay transaction.
- The bounded queue drops the oldest events rather than exhausting server memory.
- Failed batches are retried within the remaining queue capacity.
- Tokens, email addresses, chat text, private messages and arbitrary client metadata are forbidden.

Enable delivery with:

```dotenv
TELEMETRY_ENABLED=true
TELEMETRY_ENDPOINT=https://telemetry.example.invalid/events
TELEMETRY_BATCH_SIZE=100
TELEMETRY_MAX_QUEUE=10000
TELEMETRY_FLUSH_MS=5000
TELEMETRY_REQUEST_TIMEOUT_MS=5000
TELEMETRY_SHUTDOWN_TIMEOUT_MS=3000
```

When telemetry is disabled, the global service uses a no-op sink.

## Event envelope

```json
{
  "eventId": "uuid",
  "name": "combat_finished",
  "schemaVersion": 1,
  "occurredAt": "2026-07-31T16:00:00.000Z",
  "serverVersion": "1.0.0",
  "context": {
    "sessionId": "optional",
    "userId": "optional-internal-id",
    "characterId": "optional-internal-id",
    "realmId": "optional-internal-id",
    "clientVersion": "optional"
  },
  "payload": {}
}
```

Payloads are strict, named schemas. Unknown event names and malformed payloads are rejected before queueing.

## Current catalog

Acquisition and first use:

- `account_registered`
- `character_created`
- `world_entered`
- `tutorial_step_completed`

Progression and content systems:

- `quest_started`
- `quest_completed`
- `item_received`
- `item_crafted`
- `currency_changed`

Combat:

- `combat_started`
- `turn_timed_out`
- `combat_finished`
- `combat_forfeited`
- `player_defeated`

Social and economy:

- `party_joined`
- `guild_joined`
- `trade_completed`

Session lifecycle:

- `session_ended`

The schema source of truth is `src/telemetry/telemetry.contracts.ts`.

## Required dashboards

### First-session funnel

`account_registered → character_created → world_entered → tutorial_step_completed`

Measure conversion and elapsed time between stages by server version, realm and character class. Missing events must be distinguished from a zero count.

### Combat health

- median and P90 combat duration;
- median decision time;
- timeout rate by mode and participant count;
- finish reason distribution;
- defeat rate by source kind.

### Economy health

- silver credits and debits grouped by reason;
- item inflow grouped by source and item key;
- trade volume and transferred silver;
- daily median and percentile balances from the authoritative ledger.

### Retention

- D1 and D7 return rate based on authenticated user ID;
- session length distribution;
- return after first completed combat or tutorial sequence.

## Privacy and retention

- Use internal pseudonymous IDs, not display names or email addresses.
- Do not send message bodies, dialogue input, authentication tokens or IP addresses.
- Restrict raw event access to operational and analytics roles.
- Define a finite raw-event retention period at the selected telemetry provider.
- Aggregate long-lived reports so individual-player records are not exposed.
- Developer, automation and load-test accounts must be marked at ingestion and excluded from product funnels.

## Reliability metrics

`TelemetryService.getStats()` exposes queued, dropped, sent and failed counts. Production monitoring should alert on sustained delivery failures or a rising dropped-event rate, but telemetry failure must not make gameplay unavailable.
