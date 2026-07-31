# Development and deployment operations

## Local prerequisites

- Node.js 22.12 or newer
- PostgreSQL 16 or newer
- npm 10

Copy `.env.example` to `.env` and set `DATABASE_URL` and `DIRECT_URL`.

## First local setup

```bash
npm ci
npm --prefix frontend ci
npm run dev:prepare
```

`dev:prepare` is explicit. It generates Prisma Client, deploys migrations and applies pending versioned content patches. Starting either application no longer modifies the database.

Run the applications in separate terminals:

```bash
npm run start:dev
npm run frontend:dev
```

## Required local validation

Static checks do not require a running PostgreSQL instance:

```bash
npm run check:static
```

Integration checks require the configured database and intentionally exercise migrations, content deployment, content validation and a dry-run progression migration:

```bash
npm run check:integration
```

The complete local equivalent of CI is:

```bash
npm run check:all
```

## Production deployment

The deployment identity needs schema migration and content deployment permissions. The runtime identity should only need application data permissions.

```bash
npm ci --omit=dev=false
npm run build
npm run deploy:prepare
npm run progression:migrate:dry
npm run progression:migrate
npm run content:verify
npm run start
```

`npm run start` only starts `dist/main.js`. It never runs Prisma generation, migrations or seed logic.

## Content patches

Content deployment is serialized by a PostgreSQL advisory lock. Each patch has a stable ID, source hash and durable status in `ContentPatchRegistry`.

```bash
npm run content:deploy
npm run content:validate
npm run content:verify
```

Rules:

1. Never edit the source of an already applied patch under the same patch ID.
2. Add a new patch ID for each semantic content change.
3. A process restart must not change map versions or content rows.
4. A `RUNNING` patch after an interrupted deployment must be investigated before retrying.
5. Validation errors include the exact definition path and block deployment.

## Progression migration

Always inspect the dry run first:

```bash
npm run progression:migrate:dry
npm run progression:migrate
```

The migration uses a transaction and advisory lock, clamps levels to the configured maximum, recalculates class curves and preserves bonuses from equipped item definitions. Current HP and energy ratios are preserved.

## Rollback

Application rollback and database rollback are separate decisions.

1. Stop the new runtime.
2. Restore the previously known-good application image or commit.
3. Do not manually delete `ContentPatchRegistry` rows.
4. If a forward-compatible corrective patch is possible, deploy a new patch ID.
5. If data must be restored, use the verified PostgreSQL backup procedure and record the restore point.
6. Run `npm run content:verify` before accepting traffic.

Prisma migrations are treated as forward-only in normal operation. Destructive rollback requires a reviewed restore plan, not an automatic `down` script.

## CI

`.github/workflows/ci.yml` runs on every pull request and push to `main`.

- `Static checks`: formatting, backend/frontend type checks, tests, builds and production dependency audits.
- `PostgreSQL migrations and content`: clean database preparation, repeated migration/content deployment, idempotency assertions, readiness validation and progression migration dry-run.

Failed integration jobs upload schema and content registry diagnostics for seven days.
