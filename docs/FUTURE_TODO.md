# Future TODO

The following items are intentionally outside Phase 1 business logic.

## Authoritative runtime and scaling

- Add a PostgreSQL advisory-lock or lease-table mechanism so exactly one live instance owns a realm or map shard.
- Add realm-aware routing and sticky assignment at the load balancer.
- Design atomic portal handoff between map workers.
- Add a durable command journal or outbox for disconnect snapshots during simultaneous process and database failure.
- Add distributed presence with ownership fencing tokens.
- Add rolling deployment drain, reconnect tickets, and zero-downtime handoff.
- Add map cache versioning and live reload with validation and rollback.

## Combat

- Implement turn-based combat instance creation and participant locking.
- Enforce `IDLE` and `IN_BATTLE` transitions transactionally.
- Add deterministic initiative, action deadlines, server-side random seeds, and replay logs.
- Add damage, defense, critical hit, dodge, effects, death, recovery, and rewards.
- Define PvP eligibility for `SAFE`, `OUTLAW`, and `PVP` zones.
- Prevent movement, trade, and conflicting actions while in battle.

## Skills

- Add class and level requirements.
- Add rank progression and skill points.
- Add target validation, energy costs, cooldowns, effects, and combat integration.
- Add versioned skill definitions so balance changes do not corrupt active battles.

## Inventory and items

- Add capacity rules, stacking, splitting, moving, dropping, and pickup.
- Add transactional item grants and removals with idempotency keys.
- Add item binding, durability, rarity, vendors, currencies, and loot ownership.
- Add audit trails for every valuable-item mutation.

## Equipment and stats

- Implement equip and unequip validation by class, level, and slot.
- Recompute derived stats from base stats, equipment, effects, and progression.
- Define max-resource changes and safe clamping rules.
- Add outfit selection events and persist selected unlocked outfits.

## Quests

- Add quest acceptance, objective events, progress updates, completion, and reward claims.
- Add prerequisite graphs, repeatability, daily resets, and branching outcomes.
- Make reward claims transactional and idempotent.

## Mobs and NPCs

- Add server-owned actor instances separate from immutable definitions.
- Add spawn groups, roam bounds, aggro, leashing, respawn, and map-worker ownership.
- Add NPC dialogue conditions, shops, quest hooks, and scripted interactions.
- Extend spatial indexing and FOV events to non-player actors.

## Chat

- Implement global, realm, map, party, guild, private, and system channels.
- Add authorization, flood control, profanity policy hooks, mute/block lists, and moderation logs.
- Add message retention and pagination appropriate to each channel.
- Escape or sanitize content at the presentation boundary while preserving canonical server text.

## Trade

- Add proximity and state eligibility checks.
- Lock offered inventory rows and invalidate acceptance after every offer change.
- Complete item exchange in one serializable transaction.
- Add cancellation, timeout, disconnect handling, audit records, and fraud detection.

## Parties, guilds, and social systems

- Add friends, ignore lists, parties, guilds, invitations, roles, and permissions.
- Add party and guild presence channels without broad realm broadcasts.

## Persistence and data operations

- Add generated and reviewed SQL migrations to release artifacts.
- Add backup, point-in-time recovery, restore drills, and data-retention policies.
- Add soft deletion and account-erasure workflows.
- Add optimistic or fenced ownership versions to every mutable aggregate.
- Add database read replicas only for workloads that tolerate replication lag.

## Security and abuse prevention

- Add per-socket, per-user, and per-IP token-bucket rate limits.
- Add replay-resistant idempotency storage for high-value commands.
- Add anomaly detection for movement, path spam, impossible transitions, and session churn.
- Add Firebase App Check where appropriate.
- Add secret rotation and least-privilege database roles.
- Add dependency, container, and migration security scanning in CI.

## Observability

- Add structured JSON logs with realm, instance, socket, user, and character correlation fields.
- Add Prometheus metrics for online players, movement rejection codes, path-search cost, event latency, save latency, retry queue size, and database errors.
- Add OpenTelemetry traces across gateway, movement, and persistence boundaries.
- Add SLOs and alerts for disconnect-save failures and realm ownership conflicts.

## Testing

- Add PostgreSQL integration tests with isolated databases.
- Add Socket.IO end-to-end tests using Firebase emulator tokens.
- Add deterministic multi-client FOV and portal scenarios.
- Add property-based tests for pathfinding and collision invariants.
- Add load tests for dense maps, reconnect storms, and autosave batches.
- Add chaos tests for database interruption, Redis interruption, process termination, and duplicate realm writers.

## Protocol evolution

- Add explicit protocol versions and minimum supported client versions.
- Add schema compatibility tests and generated client contract packages.
- Add event idempotency and sequence numbers for reconnect reconciliation.
- Add snapshot plus delta recovery after temporary network loss.
