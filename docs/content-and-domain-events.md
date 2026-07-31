# Content releases and domain events

## Runtime versus deployment

The game process never runs Prisma migrations, seeds, or content upserts. Prepare a database explicitly:

```bash
npm run db:prepare
```

This generates the Prisma client, applies migrations, validates the current content package and activates it transactionally. Normal backend and frontend development then use:

```bash
npm run start:dev
npm run frontend:dev
```

Runtime startup performs a read-only check that the active `ContentRelease` matches `GAME_CONTENT_VERSION` and the supported content schema. Set `CONTENT_READINESS_CHECK=false` only for isolated tests or emergency diagnostics.

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
