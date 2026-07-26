# Elderglen Online — Full-Stack Grid MMORPG

A production-oriented TypeScript foundation for a Margonem-style 2D browser MMORPG.

The repository contains:

- A server-authoritative NestJS and Socket.IO backend.
- PostgreSQL persistence through Prisma.
- Firebase Admin authentication at the WebSocket boundary.
- A React, Vite, Tailwind CSS, and PixiJS browser client.
- Two finite Tiled-compatible maps with collision data and connected portals.
- Animated placeholder outfit sheets with procedural rendering fallbacks.
- Authentication, character creation, movement, visibility, portals, and persistence.

## Architecture

### Frontend

React owns authentication screens, character flow, the HUD, modals, and localization. PixiJS owns the animated world, camera, maps, players, and interpolation. The client is a renderer and command adapter rather than a second simulation.

### Backend

NestJS provides module boundaries, dependency injection, WebSocket lifecycle hooks, and shutdown coordination. Socket.IO provides namespace middleware, acknowledgements, and reconnection support. Prisma supplies typed PostgreSQL access and transactional character creation.

## Authority model

1. Firebase Web SDK authenticates the browser account.
2. The browser supplies a current Firebase ID token to the Socket.IO `/game` namespace.
3. Firebase Admin verifies the token before a world session exists.
4. PostgreSQL supplies the character's durable state.
5. The client requests a cardinal step or target tile.
6. The server validates cooldown, bounds, collision, occupancy, portals, and session ownership.
7. Only authoritative server events move the rendered character.
8. Autosave and disconnect handling persist the latest accepted state.

## Implemented browser features

- Firebase email/password registration, sign-in, session restoration, and sign-out.
- Character creator for `MAGE`, `WARRIOR`, and `ARCHER`.
- Two visually distinct outfits per class.
- Full-browser PixiJS canvas with a responsive React HUD overlay.
- Four-direction walk animation and smooth tile interpolation.
- WASD, arrow-key, and click-to-target movement.
- Server-driven collision, portal transitions, map replacement, and reconciliation.
- FOV-limited remote player rendering.
- Character, inventory, quest, and skill windows.
- Dictionary-based localization.

## Implemented backend features

- Firebase Admin token verification on the `/game` namespace.
- Durable spawn from the latest PostgreSQL snapshot.
- Direct movement and bounded four-direction A* target movement.
- Configurable accepted-step interval.
- Per-step collision, bounds, occupancy, and portal validation.
- Bucketed spatial indexing and rectangular FOV filtering.
- Real-time visible-player events.
- Automatic portal transitions and checkpoints.
- Periodic autosave, disconnect persistence, and shutdown flushing.
- Serialized command streams and stale-write protection.

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
│   ├── public/                  Browser assets and maps
│   ├── scripts/                 Reproducible asset generator
│   ├── src/
│   │   ├── auth/                Firebase Web authentication
│   │   ├── components/common/   Reusable controls and previews
│   │   ├── game/                Pixi engine, input, maps, realtime, state
│   │   ├── screens/             Authentication and character flow
│   │   └── ui/                  HUD and modal windows
│   └── test/                    Client tests
├── prisma/                      Schema, maps, and seed importer
├── src/                         NestJS backend
├── test/                        Backend tests
├── docs/                        Architecture and protocol documentation
├── Dockerfile
└── docker-compose.yml
```

## Requirements

- Node.js 22.12 or newer.
- npm 10 or newer.
- PostgreSQL 17 or another Prisma-supported PostgreSQL version.
- A Firebase project with Admin credentials and a Web application configuration.
- Redis only when `REDIS_URL` is configured.

## Local setup

### 1. Configure the backend

```bash
cp .env.example .env
```

Set PostgreSQL and Firebase Admin values. Never commit service-account credentials.

The backend accepts Firebase credentials through either:

```text
FIREBASE_SERVICE_ACCOUNT_JSON
FIREBASE_SERVICE_ACCOUNT_BASE64
```

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

Make sure PostgreSQL is running and reachable before executing Prisma migrations. The default Docker configuration exposes it on `localhost:5432`.

### 5. Start both applications

Run in separate terminals:

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

## Controls

```text
WASD / Arrow keys     Request one cardinal step
Left click            Preview A* and request the target tile
Right click / Escape  Stop scheduled path movement
C                     Toggle character sheet
I                     Toggle inventory and equipment
Q                     Toggle quest log
K                     Toggle skill tree
1-8                   Activate a visual-only action slot
```

## Important environment variables

### Backend

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

## Validation

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

## Production notes

- Serve `frontend/dist` through HTTPS.
- Proxy the Socket.IO path while preserving WebSocket upgrades.
- Prefer same-origin deployment.
- Run Prisma migrations and map validation before starting game workers.
- Keep one authoritative writer per realm or map shard.
- Use managed PostgreSQL backups and monitoring.

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
