# Production foundation operations

This document describes the operational contract introduced for issue #204. The backend remains authoritative and the existing startup chain is unchanged:

```text
prisma generate -> prisma migrate deploy -> prisma db seed -> server
```

## CI

The `CI` workflow has two independent jobs.

### Static validation

The static job uses Node.js 22 and clean `npm ci` installs for the backend and frontend. It runs:

1. Prettier checks for both workspaces.
2. Prisma validation and client generation.
3. Database-independent content validation and deterministic hash generation.
4. Backend typecheck, unit tests and production build.
5. Frontend typecheck, tests and production build.
6. Production dependency audits with a `high` severity threshold.

### PostgreSQL validation

The integration job uses the same major PostgreSQL version as `docker-compose.yml` (`postgres:17-alpine`). It deploys migrations twice, seeds twice, runs PostgreSQL integration tests and writes diagnostic reports. Logs are uploaded only when the job fails.

## Versioned content

The canonical manifest is built by `prisma/content.ts` and covers:

- maps and portals;
- NPCs and dialogue graphs;
- quests;
- mobs and encounters;
- skills;
- items and loot tables;
- recipes;
- reserved expedition and modifier sections.

The compiler:

- sorts top-level records by stable key;
- recursively sorts object keys;
- excludes generated UUID-like identifiers from the hash;
- validates references, bounds, coordinate collisions, dialogue reachability/cycles, skill prerequisite cycles, loot ranges and rewards;
- produces a SHA-256 hash and a logical diff by section.

Commands:

```bash
npm run content:validate
npm run content:deploy
npm run content:rollback -- <release-sequence-or-hash>
```

`content:validate` does not connect to PostgreSQL. Deploy and rollback acquire a row lock on the global content state and project the whole package in one transaction. A replay of the active hash is a no-op, including map versions. A failed validation cannot partially update the database.

Rollback reactivates the stored canonical manifest for the requested release. It does not delete player inventory or quest progress. New `InventoryItem` and `CharacterQuest` rows store the content hash of the definition used when they were created.

### Emergency rollback

1. Stop additional content deployments.
2. Run `npm run report:diagnostics` and identify the last known-good release sequence/hash.
3. Run `npm run content:rollback -- <target>`.
4. Re-run `npm run report:diagnostics` and the PostgreSQL integration tests.
5. Keep the feature kill switch disabled for affected features until verification is complete.

## Domain events

Every event uses the envelope below:

- event ID, type and schema version;
- occurrence and server timestamps;
- optional realm, map, character, account and session identifiers;
- operation and correlation identifiers;
- content hash and client version;
- structured payload.

PostgreSQL triggers write economic, inventory, quest, progression, map, guild and trade events in the same transaction as their source mutation. Application code can use `DomainEventService.emitInTransaction` for additional transactional events.

`DomainOutbox` is claimed with `FOR UPDATE SKIP LOCKED`. The worker provides:

- bounded batches;
- stale lock recovery;
- exponential retry;
- dead-letter status after the configured attempt limit;
- deterministic sampling for non-critical events;
- no sampling for combat, economy, item, quest and progression events;
- retention cleanup.

`DomainInbox` provides exactly-once effects for a named consumer. The claim, event read, handler side effect and processed marker share one database transaction. A failed handler rolls the claim back.

## Analytics privacy and delivery

Provider modes:

```text
ANALYTICS_PROVIDER=disabled|stdout|http
```

For HTTP mode set `ANALYTICS_HTTP_URL`. Delivery timeouts use `ANALYTICS_HTTP_TIMEOUT_MS`.

Payloads are sanitized recursively in both application code and PostgreSQL. Sensitive keys and token-like/e-mail values are replaced with `[REDACTED]`. Chat/message content, e-mail addresses, authorization values, cookies, Firebase data, tokens, secrets, passwords and credentials must never be added under alternative key names to bypass this policy.

Analytics delivery is fail-open. A provider outage moves work through retry/dead-letter handling and never rejects gameplay mutations.

Useful settings:

```text
OUTBOX_WORKER_ENABLED=true
OUTBOX_POLL_INTERVAL_MS=1000
OUTBOX_BATCH_SIZE=100
OUTBOX_MAX_ATTEMPTS=10
OUTBOX_LOCK_TIMEOUT_MS=60000
ANALYTICS_RETENTION_DAYS=90
ANALYTICS_SAMPLE_BASIS_POINTS=10000
```

## Feature flags

Feature flags are keyed and versioned. Supported scopes are account, character, realm, group and guild. Assignment uses a stable SHA-256 bucket derived from the flag salt, key, version, scope and subject ID.

The first evaluation persists an immutable assignment, including an explicit off assignment for subjects outside the rollout. Changing rollout percentage cannot reshuffle already evaluated subjects. Create a new flag version for intentional reassignment.

`disableImmediately` is the kill switch. Disabled flags return control/off even if an assignment exists.

## Reports

Commands:

```bash
npm run report
npm run report:funnel
npm run report:retention
npm run report:economy
npm run report:items
npm run report:combat
npm run report:diagnostics
```

Reports include:

- account -> character -> world -> first combat -> first quest choice -> first group funnel;
- D1/D7/D30 retention and session duration percentiles;
- currency sources/sinks and ledger/event reconciliation;
- item inflow/outflow by item and event;
- combat duration, turn duration, skill damage/healing/success and composition win rates;
- content release history, dead letters and audit drift.

A non-zero reconciliation mismatch is an incident. Do not repair it by editing analytics rows manually; identify the missing/extra business transaction and correct the source path.

## Deterministic balance simulator

Run the built-in 1v1, 3v3, 5v5 and 10v10 suite:

```bash
npm run balance:simulate
```

The simulator imports the production `CombatEngine`, combat limits and skill catalog. It does not use Prisma and cannot grant rewards or mutate player state. A fixed seed produces an identical report containing outcome distribution, TTK, survival, action usage and skill efficiency.

Custom modes:

```bash
tsx src/foundation/simulation/balance.cli.ts run scenario.json
tsx src/foundation/simulation/balance.cli.ts compare baseline.json candidate.json
```

Comparison exits with code `2` when configured TTK, win-rate or timeout thresholds are exceeded. Store accepted scenario JSON and seed values with balance change reviews so results are reproducible.

## Incident checklist

1. Run `npm run report:diagnostics`.
2. Inspect dead-letter groups and the latest content release.
3. Disable the relevant feature flag version when a kill switch is available.
4. For content defects, use transactional rollback rather than direct table edits.
5. For analytics outages, leave gameplay online; restore the provider and drain pending outbox rows.
6. For reconciliation drift, freeze affected economy operations until the operation IDs and ledger/event pairs are understood.
7. Preserve failed CI artifacts and operation/correlation IDs in the incident record.
