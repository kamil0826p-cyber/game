# Frontend Architecture

## 1. Framework and renderer selection

The browser client uses **React 19 with Vite**, **Tailwind CSS**, and **PixiJS 8**.

React owns authentication screens, character flow, overlays, modals, localization, and lifecycle composition. Vite provides a fast TypeScript development server and a production bundling pipeline without coupling the UI to a server-rendering framework. Tailwind supplies utility classes while `frontend/src/styles.css` defines the reusable retro-fantasy visual language.

PixiJS owns the continuously animated world. It is a better fit than rendering the map through React because tile sprites, camera transforms, interpolation, pointer coordinate conversion, and animation updates belong in a retained WebGL scene graph rather than the DOM reconciliation loop. Phaser would also be viable, but its scene, physics, and gameplay abstractions would duplicate the authoritative backend model. This client needs a focused renderer and input adapter, not a second game simulation.

## 2. Authority boundary

The client never decides an accepted player position.

1. Firebase Web SDK authenticates the account.
2. The client obtains an ID token and supplies it to the Socket.IO `/game` namespace handshake.
3. The backend loads or creates the durable character and sends `world:spawn`.
4. Keyboard input sends a cardinal step request.
5. Mouse input computes a local A* route only for immediate visual feedback, then sends the target coordinates.
6. The backend recomputes and validates movement one tile at a time.
7. The renderer moves only toward positions received in authoritative events or acknowledgements.

Collision data in the browser improves route previews and prevents obviously invalid clicks. It is never treated as a security boundary.

## 3. Runtime composition

```text
Firebase Auth
    |
AuthProvider
    |
GameConnectionProvider ---- typed Socket.IO client ---- NestJS /game namespace
    |                                      |
    |                                      +-- authoritative spawn, movement, FOV, portals
    |
GameStore (external observable state)
    |                         |
    |                         +-- React HUD, screens, notifications, modals
    |
PixiJS GameEngine
    +-- MapRepository and Tiled compiler
    +-- MapRenderer
    +-- CharacterView instances
    +-- KeyboardMovementController
    +-- local A* route preview
    +-- camera and viewport reporting
```

`GameStore` is intentionally small and framework-neutral. React consumes it through `useSyncExternalStore`; PixiJS subscribes directly. This avoids putting per-frame coordinates in React state and prevents the renderer from depending on UI component mounts.

## 4. Directory structure

```text
frontend/
├── public/
│   ├── assets/
│   │   ├── manifest.json
│   │   ├── sprites/             Six generated four-direction outfit sheets
│   │   └── tiles/               Two generated map tile sheets
│   └── maps/                    Exact copies of the backend Tiled seed maps
├── scripts/
│   └── generate-assets.mjs      Reproducible dependency-free PNG generator
├── src/
│   ├── auth/                    Firebase initialization and account lifecycle
│   ├── components/common/       Reusable controls and outfit preview
│   ├── config/                  Validated Vite runtime configuration
│   ├── contracts/               Shared game, socket, and Tiled payload types
│   ├── game/
│   │   ├── canvas/              React-to-Pixi lifecycle boundary
│   │   ├── engine/              Scene graph, map, character, camera, assets
│   │   ├── input/               Keyboard input adapter
│   │   ├── map/                 Tiled loading, validation, collision compiler
│   │   ├── pathfinding/         Bounded four-direction client A*
│   │   ├── realtime/            Firebase-authenticated Socket.IO client
│   │   └── state/               External observable game store
│   ├── i18n/                    English dictionary service and locale toggle
│   ├── mock/                    Explicitly visual-only Phase 2 payloads
│   ├── screens/                 Auth, creation, selection, and world screens
│   ├── ui/
│   │   ├── hud/                 Status, chat, actions, minimap, notifications
│   │   └── modals/              Character, inventory, quests, and skills
│   ├── App.tsx
│   ├── main.tsx
│   └── styles.css
├── test/                        A* and Tiled map unit tests
├── .env.example
├── index.html
├── package.json
├── tsconfig.app.json
├── vite.config.ts
└── vitest.config.ts
```

## 5. Authentication and character flow

`AuthProvider` uses Firebase email/password registration and sign-in. Browser-local persistence restores the Firebase session after refresh. `onIdTokenChanged` keeps the UI synchronized with token refresh and sign-out.

`GameSocketClient` requests a current ID token for every initial or reconnect handshake. Authentication failures force a refreshed token on the next connection attempt. No Firebase UID, character ID, class, level, position, or outfit is accepted from browser storage as authoritative state.

The backend currently enforces one character per account per realm. The client therefore displays the loaded character as a selection card before entering the world. When no character exists, it displays the class creator and both class outfits. The level 10 outfit is a locked preview; the active `outfitKey` received from the server controls the in-world sprite.

## 6. World rendering

The PixiJS application fills its host element and follows browser resizing through `resizeTo`. Device pixel ratio is capped to avoid excessive GPU fill cost on high-density displays.

The world contains three ordered layers:

1. Tile and obstacle map layers.
2. Route preview and portal indicators.
3. Y-sorted player containers.

Each `CharacterView` owns a shadow, sprite or procedural fallback, selection ring for the local player, and name/level badge. Accepted grid changes create an interpolation segment whose duration is derived from the server-provided movement interval. Four-direction walk frames advance only while the sprite is moving.

The camera follows the local interpolated sprite, clamps to map bounds, and eases toward the target. Pointer coordinates are converted from screen space into world space before selecting a tile.

## 7. Maps, collision, portals, and assets

The two client map files are copied from `prisma/maps`, making the preview collision and portal metadata identical to the backend seed input:

- `greenfields`: village/town presentation, `SAFE` zone.
- `crystal-cave`: wilderness/cave presentation, `OUTLAW` zone.

The Tiled parser validates finite orthogonal dimensions, full-size ground data, collision layers, portal properties, and object structure before compiling an O(1) collision array.

`public/assets/manifest.json` maps tile GIDs and outfit keys to PNG frame data. The loader caches texture promises, applies nearest-neighbor sampling, and slices sheets into PixiJS textures. Failed map or outfit image loads fall back to colored primitives, so missing art does not make the movement client unusable.

## 8. Multiplayer visibility

The client reports a tile half-width and half-height derived from the actual canvas size. The backend remains responsible for field-of-view membership and sends enter, move, and leave events. The client creates, updates, or destroys `CharacterView` instances from those events and never broadcasts a map-wide position request.

In non-safe zones, visible players are treated as temporary local A* blockers to improve the click route preview. The server rechecks real occupancy during every scheduled step.

## 9. UI and mock boundary

The following are implemented as interactive presentation components but contain no game mutations:

- Health, energy, experience, and derived stat displays.
- Chat tabs and local input echo.
- Quick action slots.
- Character sheet.
- Inventory and equipment grid.
- Quest log.
- Skill tree.

Their payloads live under `src/mock` and are labelled as Phase 1 visual mocks. They do not emit combat, item, quest, chat, skill, resource, or progression socket commands.

## 10. Deployment notes

For local development, Vite proxies `/api` and `/socket.io` to `VITE_DEV_BACKEND_TARGET`. In production, either serve the built static client behind the same reverse proxy as the backend or set `VITE_GAME_SERVER_URL` to the public backend origin and allow that exact origin through backend CORS.

Firebase Web configuration is public client configuration, but service-account credentials are never placed in `VITE_` variables. Production deployments should use HTTPS so Socket.IO uses secure WebSockets and Firebase tokens are never transported over plaintext.
