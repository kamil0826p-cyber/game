# Elderglen Online — Full-Stack Grid MMORPG

A production-oriented TypeScript foundation for a Margonem-style 2D browser MMORPG. The repository contains:

- A server-authoritative NestJS and Socket.IO game backend.
- PostgreSQL persistence through Prisma.
- Firebase Admin authentication at the WebSocket boundary.
- A React, Vite, Tailwind CSS, and PixiJS browser client.
- Two finite Tiled-compatible maps, strict collision data, and connected portals.
- Six animated placeholder outfit sheets, with procedural rendering fallbacks.
- Phase 1 gameplay for authentication, character creation, walking, visibility, portals, and persistence.
- Backend schemas and frontend visual mocks for future RPG systems without their business logic.

## Architecture choices

### Frontend: React + Vite + Tailwind CSS + PixiJS

React owns authentication screens, character flow, the HUD, modals, and localization. Vite provides the TypeScript development and production build pipeline. Tailwind utilities and reusable CSS components provide a responsive dark retro-fantasy UI.

PixiJS owns the continuously animated world. Tile sprites, player interpolation, camera transforms, pointer-to-world conversion, and frame updates remain outside React reconciliation. Phaser would also be capable, but its scene and gameplay abstractions would duplicate responsibilities already owned by the authoritative server. The client is deliberately a renderer and command adapter, not a second simulation.

### Backend: NestJS + Socket.IO + Prisma

NestJS provides explicit module boundaries, dependency injection, WebSocket lifecycle hooks, and shutdown coordination. Socket.IO provides namespace middleware, acknowledgements, reconnection support, and an optional Redis adapter. Prisma supplies typed PostgreSQL access and transactional character creation.

Colyseus is strong for generic room-state synchronization, but this game needs explicit tile validation, exact rectangular field-of-view interest management, database-backed realm ownership, and event-level contracts. Those requirements remain clearer in the current modular NestJS architecture.

## Authority model

1. Firebase Web SDK authenticates the browser account.
2. The browser supplies a current Firebase ID token to the Socket.IO `/game` namespace handshake.
3. Firebase Admin verifies the token before any world session exists.
4. PostgreSQL supplies the character's durable map, coordinates, direction, level, outfit, and stats.
5. The client requests a cardinal step or a target tile.
6. The server validates cooldown, bounds, collision, occupancy, portal destinations, and session ownership.
7. Only authoritative server events move the rendered character.
8. Autosave, portal checkpoints, disconnect handling, and graceful shutdown persist the latest accepted state.

The client calculates local A* paths only for immediate route feedback. It sends the destination, not an accepted route; the backend independently calculates and validates every step.

## Implemented Phase 1

### Browser client

- Firebase email/password registration, sign-in, session restoration, and sign-out.
- Firebase token authentication on initial Socket.IO connection and reconnect.
- Character creator for `MAGE`, `WARRIOR`, and `ARCHER`.
- Two visually distinct outfits per class, with level 1 and level 10 previews.
- Loaded-character selection before entering the realm.
- Full-browser PixiJS canvas with a responsive React HUD overlay.
- Tiled-compatible village and cave maps copied from the backend seed files.
- Four-direction walk animation and smooth tile interpolation.
- WASD and arrow-key cardinal movement.
- Mouse click-to-target A* route preview.
- Escape and right-click path cancellation.
- Server-driven collision, portal transitions, map replacement, and reconciliation.
- FOV-limited remote player rendering with names, levels, directions, and outfits.
- Portal fade transitions.
- Player frame, mock HP/energy/XP bars, minimap, local mock chat, and action bar.
- Toggleable character, inventory, quest, and skill windows through C/I/Q/K.
- Dictionary-based English localization with a runtime language-style toggle.
- Generated PNG tile and outfit assets plus procedural fallbacks.

### Authoritative backend

- Firebase Admin token verification on the `/game` namespace.
- One character per authenticated user per realm.
- Durable spawn from the last PostgreSQL snapshot.
- Direct movement and bounded four-direction A* target movement.
- A configurable 200 ms default accepted-step interval.
- Per-step collision, bounds, occupancy, and portal validation.
- `SAFE`, `OUTLAW`, and `PVP` map flags.
- Safe-zone overlap and non-safe occupancy blocking.
- Bucketed spatial indexing and exact rectangular FOV filtering.
- Real-time visible-player enter, move, and leave events.
- Automatic portal transitions and immediate portal checkpoints.
- Periodic autosave, disconnect persistence, retry handling, and shutdown flushing.
- Serialized command streams, duplicate-session takeover, and stale-write protection.
- Isolated realm processes with optional realm-scoped Socket.IO Redis fan-out.
- Prisma structures and NestJS module stubs for future systems.

## Strict mock boundary

The browser currently renders visual-only examples for:

- HP, energy, XP, and derived attributes.
- Quick action slots.
- Inventory and equipment.
- Quest log.
- Skill tree.

These components do not emit gameplay mutations. Combat, resource depletion, leveling, item management, quests, skills, chat transport, and trade remain future backend-driven systems.

## Repository layout

```text
.
├── frontend/
│   ├── public/
│   │   ├── assets/
│   │   │   ├── manifest.json
│   │   │   ├── sprites/             Six animated outfit sheets
│   │   │   └── tiles/               Village and cave tile sheets
│   │   └── maps/                    Browser copies of backend Tiled maps
│   ├── scripts/                     Reproducible PNG asset generator
│   ├── src/
│   │   ├── auth/                    Firebase Web authentication
│   │   ├── components/common/       Reusable controls and outfit preview
│   │   ├── config/                  Vite runtime configuration
│   │   ├── contracts/               Game, socket, and Tiled types
│   │   ├── game/
│   │   │   ├── canvas/              React-to-Pixi lifecycle boundary
│   │   │   ├── engine/              Scene graph, camera, maps, players, assets
│   │   │   ├── input/               Keyboard movement adapter
│   │   │   ├── map/                 Tiled parser and collision compiler
│   │   │   ├── pathfinding/         Bounded client A*
│   │   │   ├── realtime/            Typed Socket.IO client
│   │   │   └── state/               External observable game store
│   │   ├── i18n/                    English dictionary service
│   │   ├── mock/                    Explicit visual-only future payloads
│   │   ├── screens/                 Auth and character flow
│   │   └── ui/                      HUD and mock modals
│   └── test/                        Client map and pathfinding tests
├── prisma/
│   ├── maps/                        Authoritative Tiled-compatible seed maps
│   ├── schema.prisma                Current and future database structures
│   └── seed.ts                      Realm, map, and portal importer
├── src/
│   ├── auth/                        Firebase verification and socket middleware
│   ├── common/                      Domain types, errors, serialization
│   ├── config/                      Strict environment validation
│   ├── contracts/                   Canonical socket event and payload schemas
│   ├── database/                    Prisma lifecycle service
│   ├── health/                      Liveness endpoint
│   ├── i18n/                        Backend localization service
│   └── modules/
│       ├── characters/              Account and character lifecycle
│       ├── maps/                    Collision and portal runtime cache
│       ├── movement/                Cooldown, A*, collision, portals
│       ├── persistence/             Autosave and disconnect snapshots
│       ├── realm/                   Realm selection
│       ├── realtime/                Gateway and session lifecycle
│       ├── world/                   Runtime sessions, spatial index, FOV
│       └── future/                  Future interfaces and empty modules
├── test/                            Backend unit tests
├── docs/                            Architecture, protocol, reviews, roadmaps
├── Dockerfile
└── docker-compose.yml
```

## Requirements

- Node.js 22.12 or newer.
- npm 10 or newer.
- PostgreSQL 17 or another Prisma-supported PostgreSQL version.
- A Firebase project with:
  - Firebase Admin credentials for the backend.
  - A Firebase Web application configuration for the browser.
- Redis only when `REDIS_URL` is configured.

## Local setup

### 1. Configure the backend

```bash
cp .env.example .env
```

Add PostgreSQL and Firebase Admin values. Never commit service-account credentials.

### 2. Configure the frontend

```bash
cp frontend/.env.example frontend/.env
```

Fill in the public Firebase Web application values. Never put Firebase Admin credentials in a `VITE_` variable.

### 3. Install dependencies

```bash
npm install
npm --prefix frontend install
```

### 4. Start infrastructure and prepare the database

```bash
docker compose up -d postgres redis
npm run prisma:generate
npm run prisma:migrate:dev -- --name initial
npm run prisma:seed
```

### 5. Start both applications

Run these in separate terminals:

```bash
npm run start:dev
```

```bash
npm run frontend:dev
```

Default local endpoints:

```text
Backend health:  http://localhost:3000/api/health
Socket.IO:       ws://localhost:3000/game
Frontend:        http://localhost:5173
```

Vite proxies `/api` and `/socket.io` to `VITE_DEV_BACKEND_TARGET`, which defaults to `http://localhost:3000`.

## Frontend controls

```text
WASD / Arrow keys     Request one cardinal step
Left click            Preview A* and request the target tile
Right click / Escape  Stop scheduled path movement
C                     Toggle character sheet
I                     Toggle inventory and equipment mock
Q                     Toggle quest log mock
K                     Toggle skill tree mock
1-8                   Activate a visual-only action slot
```

## Important environment variables

### Backend

The complete list is in `.env.example`. Key values include:

```text
DATABASE_URL
FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_BASE64
GAME_REALM_SLUG
MOVE_STEP_MS
AUTOSAVE_INTERVAL_MS
CORS_ORIGINS
REDIS_URL
```

### Frontend

The complete list is in `frontend/.env.example`:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_GAME_SERVER_URL
VITE_SOCKET_PATH
VITE_DEFAULT_LOCALE
```

The Firebase Web values identify a public client application. Access control still depends on Firebase security rules and backend ID-token verification.

## Validation and builds

### Backend

```bash
npm run typecheck
npm test
npm run prisma:validate
npm run build
```

### Frontend

```bash
npm run frontend:typecheck
npm run frontend:test
npm run frontend:build
```

### Entire repository

```bash
npm run check:all
```

The frontend production output is written to `frontend/dist`.

The environment used to assemble this archive could not reach its package registry. As a result, a dependency-backed frontend Vite build and generated frontend lockfile could not be completed here. Direct frontend dependency versions are pinned exactly. After a successful local installation, run the checks above and commit the generated `frontend/package-lock.json` before production deployment.

## Production deployment

- Serve `frontend/dist` through HTTPS.
- Proxy the configured Socket.IO path to the backend, preserving WebSocket upgrades.
- Prefer a same-origin deployment; otherwise set `VITE_GAME_SERVER_URL` and backend `CORS_ORIGINS` to exact public origins.
- Run Prisma migrations and map validation before starting game workers.
- Keep one authoritative writer per realm or explicitly assigned map shard.
- Use sticky realm routing; the Redis adapter does not merge separate in-memory simulations.
- Use managed PostgreSQL backups and monitoring.
- Add a durable outbox before claiming persistence through simultaneous process and database failure.

## Architectural invariants

1. The server, not the browser, owns accepted positions.
2. Every path step is validated again when executed.
3. PostgreSQL is the durable source of truth.
4. One serialized command stream mutates each character.
5. One authoritative process owns a realm or map shard.
6. Visibility is interest-managed by the backend.
7. Older snapshots cannot overwrite newer character revisions.
8. Future UI panels remain mocks until authoritative contracts exist.

## Documentation

- [Backend architecture](docs/ARCHITECTURE.md)
- [Frontend architecture](docs/FRONTEND_ARCHITECTURE.md)
- [Backend socket protocol](docs/SOCKET_PROTOCOL.md)
- [Frontend socket integration](docs/FRONTEND_SOCKET_INTEGRATION.md)
- [Map format](docs/MAP_FORMAT.md)
- [Backend implementation self-review](docs/SELF_REVIEW.md)
- [Frontend implementation self-review](docs/FRONTEND_SELF_REVIEW.md)
- [Backend future TODO](docs/FUTURE_TODO.md)
- [Frontend future TODO](docs/FRONTEND_TODO.md)
