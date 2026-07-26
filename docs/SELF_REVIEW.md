# Backend Implementation Self-Review

This review is ordered by the failure modes most likely to damage authoritative state.

## 1. Scope and language

- Backend server, database schema, seed data, socket contracts, tests, and documentation only.
- No HTML, CSS, canvas rendering, browser UI, or frontend game code.
- Source names, variables, comments, messages, schema names, and documentation are English.
- Future systems contain interfaces, database structures, and empty Nest modules only; no combat, inventory, quest, chat, or trade business logic is active.

## 2. Authentication boundary

- Firebase verification is attached to the actual `/game` namespace rather than only the default Socket.IO namespace.
- Missing and invalid tokens are rejected before `handleConnection` creates state.
- Long-running user/character loads recheck `socket.connected` immediately before world registration, preventing a disconnected handshake from creating an orphaned online session.
- Socket session phases reject character or movement commands sent before the connection has reached the corresponding ready state.
- The Firebase UID is read only from a verified decoded token.
- Service-account JSON accepts both standard snake_case credentials and Firebase Admin camelCase fields.
- Revocation checks are configurable and enabled by default.

## 3. Non-blocking asynchronous database behavior

- All Prisma calls are awaited promises; no synchronous filesystem or database operations exist in request handlers.
- Autosave uses bounded concurrency rather than one unbounded `Promise.all` over all players.
- Recovery flushing for queued disconnect snapshots uses the same bounded concurrency limit.
- Per-character persistence is serialized to prevent autosave, portal, and disconnect writes from racing.
- Character creation uses a short interactive transaction and database unique constraints.
- Seed files and every portal endpoint are validated before writes; realm, maps, portals, and the default map are then updated atomically.
- No transaction is kept open while waiting on Socket.IO or external client activity.

## 4. Authoritative movement

- The client supplies only a cardinal direction or target coordinates.
- The server computes the next tile and final committed position.
- Direct and path commands share a per-character serial executor.
- Viewport mutation, disconnect cleanup, and duplicate-session removal use the same movement command executor.
- A separate session-claim executor serializes the complete duplicate-session save, durable reload, spawn reservation, and registration sequence.
- Disconnect cleanup runs after any already accepted in-flight movement, preventing lost final steps and spatial-index ghosts.
- The cooldown is checked before every accepted tile and the next cooldown starts at the actual commit timestamp.
- Out-of-bounds and collision checks happen before runtime mutation.
- Non-safe-zone occupancy is checked before runtime mutation.
- A* is four-directional and bounded by both path length and expanded-node count.
- Scheduled path steps repeat all movement checks and stop on dynamic failure. Timer execution failures are caught and cannot become unhandled rejections.
- A direct step cancels the remaining path.

## 5. Portals and maps

- Tiled root dimensions, property collections, tile layers, object entries, collision arrays, spawns, portal sources, and portal targets are validated.
- Collision lookup is a compiled O(1) array operation.
- Portal lookup is an O(1) tile-key map operation.
- A portal destination is checked for collision and non-safe occupancy before transition.
- Portal transitions update the spatial index before visibility reconciliation.
- A portal transition cancels the remaining path and starts an immediate immutable-snapshot checkpoint without waiting on database latency in the movement hot path.

## 6. Visibility correctness

- Spatial buckets reduce candidate lookup; exact coordinates are checked afterward.
- Visibility relations are directed, supporting different viewport sizes per player.
- Spawn links both the new viewer and existing viewers when each can see the other.
- Movement compares old and new watcher candidates and emits enter, move, or leave.
- Portal movement gives the mover a complete nearby-player replacement set and removes the mover from old-map viewers.
- Disconnect emits leave to every current watcher before deleting the runtime session.

## 7. Disconnect and persistence hooks

- `handleDisconnect` captures an immutable snapshot before deleting runtime state.
- Path timers are cancelled before the session is removed.
- Disconnect removal is serialized behind in-flight movement for the same character.
- Visibility links are removed before persistence I/O, so a slow database does not leave a ghost player.
- The disconnect write is awaited and retried.
- A failed disconnect snapshot remains in an in-process detached queue.
- Autosave retries detached snapshots.
- Reconnection and takeover flush pending detached snapshots before reloading the character.
- Concurrent takeovers are serialized so an older loaded revision cannot overwrite the displaced session's final position.
- Invalid or occupied stored spawn positions increment `stateVersion`, remain dirty, and are persisted through the normal immutable-snapshot path.
- SIGINT and SIGTERM invoke `app.close()`, which runs shutdown persistence hooks, followed by Redis disposal.
- Prisma disconnects in `onApplicationShutdown`, after the `beforeApplicationShutdown` save phase and connection closure, rather than disconnecting before final saves.
- Gateway command acceptance stops during `onModuleDestroy`; path timers are cancelled and the movement command executor is drained before the final save hook captures sessions.
- Character map, coordinates, direction, level, experience, outfit, combat state, HP, energy, and base stats are included in snapshots.
- `stateVersion` prevents an older snapshot from replacing a newer database state.

## 8. Scalability boundaries

- Realm selection is configuration-driven.
- World state, movement, persistence, maps, authentication, and future features are separate modules.
- FOV broadcasts are local interest-managed sends, not map-wide broadcasts.
- The Redis adapter is optional, realm-keyed, and isolated in the Socket.IO adapter.
- Documentation explicitly prohibits random multi-writer deployment for one realm until distributed ownership is added.

## 9. Operational checks

The intended validation sequence is:

```bash
npm install
npm run prisma:validate
npm run typecheck
npm test
npm run build
npm run format:check
```

A local PostgreSQL integration check should then run migration, seed, connection, movement, portal, disconnect, and reconnect scenarios.

## 10. Residual production risks

- An in-process detached queue cannot survive simultaneous loss of the game process and PostgreSQL. Add a durable outbox or synchronously replicated command journal for that failure class.
- A realm has no distributed lease yet. Orchestration must enforce one authoritative writer.
- No per-IP or per-user event-rate limiter is implemented beyond movement cooldown and bounded pathfinding.
- No metrics exporter, tracing pipeline, or alert rules are included.
- No rolling map-version migration protocol is included.
- The process-local claim and movement queues assume the documented one-writer-per-realm deployment model.
