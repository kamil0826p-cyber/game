# Architecture

## 1. Process topology

Each deployed game process owns one configured realm selected by `GAME_REALM_SLUG`. Firebase is the identity authority and PostgreSQL is the durable game-state authority. Runtime player sessions, collision arrays, portal lookups, and spatial buckets are process-local acceleration structures.

The safe Phase 1 deployment unit is one authoritative writer per realm. Additional realms scale horizontally as separate processes. Future map sharding can preserve the same rule by assigning each map to exactly one worker and handing a player session off atomically at portals.

`GAME_REALM_INSTANCE_ID` identifies the deployed process in health output and operational logs. It does not grant ownership by itself. Production orchestration should guarantee unique assignment or add the realm-lease item from the future checklist.

## 2. Module boundaries

### Authentication

`FirebaseSocketAuthMiddleware` verifies the Firebase ID token on the `/game` namespace. It writes a minimal `AuthContext` to `socket.data`. No user or character database state is accepted from the client.

### Realm and maps

`RealmService` resolves the configured realm once. `MapService` loads all realm maps at startup, validates dimensions, compiles collision layers into `Uint8Array` values, creates O(1) portal lookups, and validates every portal source and destination.

### Character lifecycle

`CharacterService` upserts the Firebase user, loads the realm character, and creates a new character transactionally. The unique database constraints enforce one character per user per realm and unique names per realm.

`SessionLifecycleService` resolves a valid spawn, repairs invalid stored coordinates, replaces duplicate sessions, creates runtime state, registers visibility, and performs disconnect persistence. `SessionClaimExecutor` serializes the full save-reload-register sequence for one character, so two concurrent replacement sockets cannot both act on the same pre-takeover database revision.

Database-backed connection setup can outlive a socket. The lifecycle therefore rechecks the transport before emitting readiness and immediately before world registration; a socket that closed during loading cannot leave an orphaned runtime player. After any takeover or disconnect race, the lifecycle flushes detached snapshots and reloads the character from PostgreSQL before creating the replacement session. Non-safe spawn occupancy is checked again immediately before the synchronous world-state registration.

### World state and interest management

`WorldStateService` is the in-process character-session registry. `SpatialIndexService` stores character IDs in fixed-size map buckets. Rectangle queries inspect only intersecting buckets and then apply exact coordinate filtering.

`VisibilityService` maintains directed relations:

- `viewer.visibleCharacterIds` contains subjects visible to the viewer.
- `subject.watcherCharacterIds` contains viewers currently watching the subject.

This supports asymmetric viewports and avoids map-wide movement broadcasts.

### Movement

`MovementCoordinatorService` serializes commands per character. It coordinates direct steps, path requests, viewport changes, path cancellation, and lifecycle quiescing. Disconnect and duplicate-session replacement are queued behind any in-flight movement before they capture and remove the session, so an accepted final step cannot be lost or reinsert a ghost spatial-index entry.

`PathfindingService` performs bounded four-direction A* search. Limits on total path length and expanded nodes prevent an untrusted target request from consuming unbounded CPU.

`MovementService` is authoritative. An accepted step must pass all checks in this order:

1. The session is still the active connection for the character.
2. The movement cooldown has elapsed at the time of the attempt.
3. The source map exists.
4. The destination is exactly one cardinal tile and is inside the map.
5. The destination is not a collision tile.
6. The destination is not occupied in a non-safe zone.
7. A portal destination, when present, exists and is walkable.
8. A non-safe portal destination is not occupied.

Only after validation does the service take the authoritative commit timestamp, start the next cooldown from that timestamp, mutate runtime state, update the spatial index, publish visibility deltas, and create a portal checkpoint when needed.

### Persistence

`PlayerPersistenceService` captures immutable snapshots. Writes for one character are serialized, include all Phase 1 mutable fields, and use `stateVersion <= snapshot.revision` as a stale-write guard.

`AutosaveService` periodically captures dirty sessions and saves them with bounded concurrency. A save only clears the dirty flag when the exact saved revision is still current.

A disconnect removes the session from world visibility immediately, then queues its immutable snapshot. The detached queue retries transient failures and remains available to the autosave cycle. Reconnection and duplicate-session takeover flush queued snapshots before loading the character again. A repaired spawn increments the runtime revision and remains dirty until the repair snapshot is stored.

### Realtime transport

`GameGateway` exposes one typed Socket.IO namespace. Zod validates all untrusted event payloads. Acknowledgements return structured success or error values, while movement state events support continuous rendering and reconciliation.

`WorldEventsPublisher` centralizes outbound per-socket events so domain services do not depend directly on gateway decorators.

## 3. Concurrency model

Node.js does not make asynchronous mutations atomic. Two handlers can interleave at `await` boundaries. The movement `KeyedSerialExecutor` creates a promise chain per character so direct movement, scheduled path steps, viewport changes, and lifecycle cleanup run in order.

`SessionClaimExecutor` is a separate per-character chain for connection ownership. It keeps duplicate-session removal, final persistence, durable reload, spawn selection, and registration inside one exclusive claim. Persistence has its own per-character serial executor so autosave, portal checkpoint, repair, and disconnect writes cannot run concurrently. The database version guard provides a second line of defense against stale snapshots.

## 4. Failure handling

- Invalid authentication is rejected before a world session exists.
- Invalid event payloads produce `INVALID_PAYLOAD` acknowledgements.
- Movement rejection always includes the authoritative map, coordinates, and direction.
- Map compilation errors fail application startup rather than allowing unsafe maps.
- Portal checkpoints are started from an immutable snapshot without holding the movement command queue on database latency. Failures leave the session dirty for autosave.
- Scheduled path timer failures are caught, logged, and cancel the path instead of becoming unhandled promise rejections.
- Disconnect failures leave the immutable snapshot in the detached retry queue.
- SIGINT and SIGTERM trigger application shutdown, session flushing, Prisma disposal, and Redis disposal. Bootstrap failures also close Nest resources and any partially connected Redis clients.
- Prisma stays connected through the final save hook and closes in `onApplicationShutdown`, after Nest has completed `beforeApplicationShutdown` handlers and closed network connections.
- During `onModuleDestroy`, the gateway rejects new commands, path timers are cancelled, and the per-character command executor is drained. The subsequent final-save hook therefore snapshots stable runtime state.

## 5. Complexity

Let `P` be the number of players in a realm, `B` the number of players in buckets intersecting a viewport, and `N` the number of A* nodes expanded.

- Session lookup: expected O(1).
- Collision lookup: O(1).
- Portal lookup: expected O(1).
- Occupancy lookup: expected O(players in one bucket), followed by exact tile filtering.
- FOV query: O(number of intersecting buckets + B).
- Movement viewer updates: proportional to viewers near the old and new positions, not P.
- Pathfinding: O(N log N), capped by `MAX_PATH_NODES`.

## 6. Security boundaries

- Firebase UID comes only from a verified token.
- Character ID, position, stats, outfit, level, and map are loaded from PostgreSQL or server defaults.
- Client coordinates are targets, never authoritative state.
- Every payload is size- and type-constrained by Zod.
- Path search and viewport sizes are capped by server configuration.
- Collision and portals are compiled from server-controlled database records.
- Firebase credentials and database secrets are environment-only.

## 7. Known Phase 1 boundary

The optional Redis adapter provides Socket.IO packet fan-out through a realm-scoped channel prefix, but it does not distribute `WorldStateService`. Running multiple random writers for the same realm would create split-brain collision and FOV decisions. Keep one writer per realm until distributed leases, entity ownership, and cross-worker handoff are implemented.
