# Elderglen Online Frontend

A React, TypeScript, Tailwind CSS, and PixiJS browser client for the NestJS grid MMORPG in the repository root.

## Development

```bash
cp .env.example .env
npm install
npm run dev
```

With `VITE_GAME_SERVER_URL` left empty, Vite proxies `/api` and `/socket.io` to `VITE_DEV_BACKEND_TARGET`, which defaults to `http://localhost:3000`.

The generated fallback assets are committed. Run `npm run assets:generate` only when you want to reproduce them.

## Validation

```bash
npm run typecheck
npm test
npm run build
npm run format:check
```

## Runtime contract

The browser authenticates through Firebase Web SDK, obtains an ID token, and sends it in the Socket.IO `/game` namespace handshake. The backend remains authoritative for every accepted step, collision, portal transition, visible-player event, and persisted position.

The client calculates a bounded local A* route for immediate click feedback, then sends only the destination coordinates. The server independently calculates and validates its route one step at a time.

## Main boundaries

```text
src/auth          Firebase account lifecycle
src/game/engine   PixiJS scene graph, camera, players, maps, assets
src/game/input    Keyboard movement adapter
src/game/map      Tiled loading and collision compilation
src/game/realtime Typed Socket.IO integration
src/game/state    React-independent observable game state
src/screens       Authentication and character flow
src/ui            HUD and visual-only future-system mocks
```

See the repository documentation:

- `docs/FRONTEND_ARCHITECTURE.md`
- `docs/FRONTEND_SOCKET_INTEGRATION.md`
- `docs/FRONTEND_SELF_REVIEW.md`
- `docs/FRONTEND_TODO.md`
