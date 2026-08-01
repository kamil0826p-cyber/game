# Production foundation operations

This document describes the production foundation introduced for issue #204: CI, versioned content, domain events, analytics, reports, deterministic balance simulation and feature flags.

## Startup and deployment invariant

The backend startup chain is intentionally unchanged:

```text
start / start:dev / start:debug
  -> prisma:generate
  -> prisma:migrate:deploy
  -> prisma:seed
  -> application process
```

Do not remove `prisma:prepare` from any backend start command. The seed is part of deployment safety: it validates the content source, applies the existing idempotent data seeds, and activates a version only after all content has been written successfully.

A normal deployment is:

```bash
npm ci
npm run build
npm run start
```

The same content hash is an idempotent replay. It does not create a new `ContentVersion`, reset a character, replace inventory, remove quest progress or alter currency balances.

## Content validation and versioning

Mechanical content is represented by `prisma/content/current-content.manifest.ts`. The manifest covers maps, portals, NPC dialogue, quests, mobs, encounters, skills, items, loot, recipes and reserved expedition/modifier categories.

Run source-only validation without writing the database:

```bash
npm run content:validate
```

Validation fails before deployment for duplicate keys, missing references, skill cycles, unreachable dialogue nodes, occupied coordinates, invalid rewards and invalid loot bounds. Hashing canonicalizes object keys and keyed arrays and ignores database IDs and timestamps, so UUID allocation and record order cannot change the version.

During `prisma:seed`:

1. `seed-foundation validate` compiles and validates the source package.
2. Existing idempotent seeds write definitions in one transaction per seed unit.
3. `seed-foundation deploy` snapshots the resulting database definitions.
4. The logical diff and stable hash are persisted.
5. The active pointer changes transactionally only after the snapshot is complete.

Existing `InventoryItem` and `CharacterQuest` rows retain a `definitionVersionHash`, preserving the definition semantics under which the player instance was created.

## Content rollback

List available versions:

```sql
SELECT "hash", "status", "activatedAt", "createdAt"
FROM "ContentVersion"
ORDER BY "createdAt" DESC;
```

Rollback to a known hash:

```bash
npm run content:rollback -- rollback:<64-character-hash>
```

Rollback runs in a database transaction. It restores the snapshotted maps, portals, NPCs, quests, mobs, skills, prerequisites and items, then moves the active pointer. Player inventory, character quests and balances are not deleted. Legacy definitions referenced by player instances are retained rather than destructively removed.

Emergency rule: if validation or materialization fails, leave the current active pointer unchanged, fix the source, and redeploy. Never manually edit `ActiveContentVersion` without restoring definitions in the same transaction.

## Domain events, outbox and replay

Every event uses a versioned envelope with server time, optional realm/map/character/account/session context, operation/correlation IDs, active content hash, client version and a sanitized payload.

Currency ledger inserts, inventory mutations and quest state transitions are protected by PostgreSQL triggers. The domain row, `DomainEvent` and `EventOutbox` row are committed or rolled back together.

The worker claims rows with `FOR UPDATE SKIP LOCKED`. Processing uses bounded exponential backoff, stale-lock recovery and dead-lettering. Provider failure cannot roll back or block gameplay because delivery happens after the gameplay transaction.

Replay consumers must use `ExactlyOnceEventConsumer`:

```ts
await consumer.consume('economy-projection-v1', event.id, async (tx) => {
  // projection/effect using tx
});
```

`EventInbox` has a unique `(consumer, eventId)` key. The inbox claim and effect share a transaction, so repeated delivery produces one effect.

To retry a dead letter after fixing the cause:

```sql
BEGIN;
DELETE FROM "EventDeadLetter" WHERE "outboxId" = '<outbox uuid>';
UPDATE "EventOutbox"
SET "status" = 'PENDING', "attempts" = 0, "availableAt" = NOW(),
    "lockedAt" = NULL, "lockedBy" = NULL, "lastError" = NULL
WHERE "id" = '<outbox uuid>';
COMMIT;
```

Do not replay by directly calling reward code. Replay the event through an inbox-protected consumer.

## Analytics and privacy

Gameplay truth comes only from server domain events. There is no client analytics SDK in the authoritative path.

Configuration:

- `ANALYTICS_PROVIDER=disabled|stdout|http`
- `ANALYTICS_HTTP_URL` for the HTTP provider
- `ANALYTICS_HTTP_TIMEOUT_MS` (default `3000`)
- `ANALYTICS_SAMPLE_RATE` from `0` to `1`
- `ANALYTICS_RETENTION_DAYS` (default `90`)
- `OUTBOX_BATCH_SIZE`, `OUTBOX_POLL_INTERVAL_MS`, `OUTBOX_STALE_LOCK_SECONDS`, `OUTBOX_MAX_ATTEMPTS`

The sanitizer recursively redacts email addresses, chat/message content, authorization, cookies, Firebase values, access/refresh/ID tokens, passwords, credentials and secrets. Economy, item, quest reward and combat events are critical and are never sampled. Retention cleanup removes only events whose outbox delivery completed.

## Reports and alerts

Generate the operational/product report:

```bash
npm run report:foundation
```

The command reports funnel stages, D1/D7/D30 retention, session duration, item flow, combat/turn percentiles, skill usage, outbox/dead-letter health and content failures. It also reconciles character balances to the currency ledger and exits with code `2` when any difference exists.

Suggested alerts:

- any economy reconciliation difference;
- dead-letter count greater than zero;
- oldest pending outbox age above five minutes;
- content version in `FAILED` status;
- unexpected TTK or survivor regression in the simulator report.

## Deterministic balance simulator

The simulator imports the production `CombatEngine` and production skill catalog. It does not connect to Prisma and cannot grant rewards.

```bash
npm run balance:simulate
npm run balance:simulate -- --output=artifacts/balance.json
npm run balance:simulate -- --baseline=artifacts/baseline.json
```

Default scenarios cover solo, 3v3, 5v5 and 10v10. Identical seeds produce identical initiative, hit resolution and reports. Baseline comparison checks TTK and survivor deltas and returns a failing exit code when configured thresholds are exceeded.

## Feature flags

Flags are immutable by `(key, version)` for scope, salt and variants. Publish a new version to change those fields. Enabling/disabling and rollout percentage are operational controls.

Assignments are persisted for account, character, realm, group or guild scope. The bucket depends only on immutable flag identity and the scope ID. Increasing rollout therefore adds users without reshuffling existing assignments. Disabling a flag is an immediate kill switch and resolves to control without deleting assignments.

## CI

The static job performs clean backend/frontend installs, Prettier checks, Prisma validation/generation, backend/frontend typechecks, unit tests, builds and production dependency audits at `high` severity.

The PostgreSQL job uses PostgreSQL 17, migrates an empty database, replays migrations, seeds twice, and runs integration tests for content idempotency, atomic event writes, transaction rollback, fivefold exactly-once replay and ledger reconciliation. On failure it uploads schema and operational diagnostics as workflow artifacts.
