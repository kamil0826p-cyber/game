# Content releases and domain events

## Startup preparation

Every backend startup intentionally prepares Prisma before the application process starts:

```bash
npm run prisma:prepare
```

The preparation chain is fixed and regression-tested:

1. `prisma generate`;
2. `prisma migrate deploy`;
3. `prisma db seed`.

Prisma seed delegates to the versioned content deployment CLI. The deployment is transactionally locked and idempotent, so restarting the backend with an unchanged package does not create another release or reset player-owned data.

The following scripts all execute the preparation chain:

```bash
npm run start
npm run start:dev
npm run start:debug
```

`npm run db:prepare` remains an explicit alias for the same operation. Runtime startup additionally performs a read-only check that the active `ContentRelease` matches `GAME_CONTENT_VERSION` and the supported content schema. Set `CONTENT_READINESS_CHECK=false` only for isolated tests or emergency diagnostics.

## Content commands

```bash
npm run content:validate
npm run content:compile -- --output=artifacts/content/current.json
npm run content:dry-run
npm run content:deploy -- --operation-id=deploy-2026-07-31 --author=name
npm run content:rollback -- 2026.07.31.1 --allow-risky
```

Deploys use a PostgreSQL advisory transaction lock. A repeated deployment of the same version and source hash is a no-op. A version cannot be reused with different content. Map or quest changes and removals require `--allow-risky`. Rollback reapplies a stored manifest; it does not delete player-owned data or replay rewards.

## Domain events

A domain mutation calls `DomainEventService.append(tx, event)` with the same Prisma transaction used for the mutation. The service writes `DomainEvent` and `EventOutbox` atomically. The dispatcher claims work with `FOR UPDATE SKIP LOCKED`, retries with backoff and moves exhausted messages to `DEAD`.

Consumers use `consumeExactlyOnce(consumer, eventId, handler)`. The inbox receipt and consumer side effect share a transaction, so duplicate delivery and replay do not duplicate effects. The built-in consumer materializes declared contributions in `ContributionLedger`.

Replay selected events without repeating completed consumer effects:

```bash
npm run events:replay -- --type=CombatFinished --from=2026-07-31T00:00:00Z
```

## CI verification

The static CI job validates formatting, Prisma, the content package, backend and frontend typechecks, unit tests, builds, and production dependency audits.

The PostgreSQL 17 job applies migrations twice, runs Prisma seed twice, verifies that the following content dry-run is empty, and then executes the integration suite. Failed jobs upload generated content, npm logs, and database diagnostics as workflow artifacts.
