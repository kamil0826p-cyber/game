# Elderglen Online — server-authoritative browser MMORPG

TypeScript monorepo containing a NestJS/Socket.IO backend and a React/PixiJS client. PostgreSQL and Prisma store durable game state, while the backend remains authoritative for movement, combat, progression, inventory, trade, groups, guilds, quests, mobs and realtime sessions.

## Stack

- Node.js 22.12+
- NestJS and Socket.IO
- PostgreSQL 16 and Prisma
- React, Vite and PixiJS
- Vitest and GitHub Actions

## Repository layout

- `src/` — backend modules and realtime contracts
- `frontend/` — browser client
- `prisma/` — schema, migrations and bootstrap content
- `scripts/content/` — versioned content deployment and validation
- `scripts/progression/` — safe character progression migration
- `test/` — backend unit and integration-oriented tests
- `docs/` — design and operational decisions

## Local setup

Create `.env` from `.env.example` and configure `DATABASE_URL`, `DIRECT_URL` and Firebase credentials.

```bash
npm ci
npm --prefix frontend ci
npm run dev:prepare
```

Start backend and frontend separately:

```bash
npm run start:dev
npm run frontend:dev
```

Application startup does **not** run migrations or seed data. Database and content preparation are explicit operations.

## Validation

```bash
npm run check:static
npm run check:integration
npm run check:all
```

`check:static` runs formatting, backend/frontend type checks, tests and builds. `check:integration` requires PostgreSQL and verifies Prisma migrations, repeatable content deployment, content integrity and a progression migration dry-run.

The same gates run in `.github/workflows/ci.yml` for every pull request and push to `main`.

## Deployment

```bash
npm run build
npm run deploy:prepare
npm run progression:migrate:dry
npm run progression:migrate
npm run content:verify
npm run start
```

`npm run start` only starts the compiled server. It does not modify the database.

See [development and deployment operations](docs/OPERATIONS.md) for locks, patch rules, rollback and CI diagnostics.

## Core mechanics in this branch

- configurable maximum character level;
- versioned, class-specific stat curves;
- deterministic experience and skill-point policies;
- safe migration preserving equipped-item bonuses;
- fast classical combat turns with a server-owned deadline;
- deterministic timeout fallback;
- data-driven mob skills, phases and legal-action AI;
- authoritative telegraph lifecycle and counter hooks;
- versioned telemetry contracts with bounded nonblocking delivery;
- content validation for references, map bounds, dialogue graphs, loot and skill cycles;
- durable, idempotent content patch registry.

## Design and operations

- [Combat round decision](docs/COMBAT_DESIGN.md)
- [Telemetry contracts and metrics](docs/TELEMETRY.md)
- [Development, deployment and rollback](docs/OPERATIONS.md)

## Authority and safety rules

- The client sends commands; the server validates and resolves them.
- Resource-granting operations must be transactional and idempotent.
- Reconnect and retries must not duplicate rewards or actions.
- Runtime startup must not migrate schemas or deploy content.
- Content definitions use stable keys and versioned validation.
- Authentication tokens, private messages and arbitrary client metadata must not enter telemetry.
