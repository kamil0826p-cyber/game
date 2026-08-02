# Issue #213 — implementation and self-review

## Scope implemented

- Persistent social realm and guild aggregate state with serialized mutations and idempotent operation ledgers.
- Finder for 1–10 characters, manual/automatic acceptance, functional build declarations, readiness, risk acceptance, server-side requirements and frozen roster start.
- Remote finder roster assembly in the existing group service while preserving the existing nearby invite workflow.
- Recent-player history, contacts and bilateral blocks.
- Mentoring profile and sessions with same-account rejection, real-progress requirement, AFK rejection and a weekly reward cap.
- Versioned guild contracts and projects with frozen definition snapshots, qualified contribution, per-character/account caps, idempotent settlement and guild XP exclusively from settlement audit entries.
- Horizontal guild unlock keys rather than combat-stat bonuses.
- Granular persisted guild-role permissions. Existing invite, description, role, kick and disband operations re-check permissions under the guild row lock.
- Transactional item-only guild bank with row locks, operation replay protection, daily withdrawal limits, project locks and immutable audit. No silver or premium-gold transfer API exists.
- Timezone-safe guild events/RSVP and announcements in the persisted guild social state.
- Region goals available to solo and guild players with personal caps and diminishing returns.
- Basic operational metrics: finder fill/dropoff, AFK/disconnect, mentoring completion/flags and guild reward concentration.
- Social hub UI under `H`, integrated with existing group/guild HUD surfaces.

## Concurrency and economy review

- Realm and guild JSON aggregates use `SERIALIZABLE` transactions plus `SELECT ... FOR UPDATE`.
- Finder start validates readiness and assembles the exact frozen roster inside the serialized critical section.
- Bank withdrawals lock the guild, bank item and daily-usage row before inventory grant and decrement.
- Bank operation keys are `(guildId, operationId)` and reject payload collisions.
- Inventory grants use the existing itemization snapshot and inventory capacity rules; overflow claims are disabled for bank withdrawal.
- Guild XP writes occur only in contract/project settlement paths and each write has an XP audit entry.
- Settlement replay uses the original operation result and a deterministic metric operation key, avoiding duplicate XP and analytics.

## Self-review fixes made before publication

1. Mentoring abuse was initially marked and then thrown inside the transaction, which would roll the flag back. It now persists a `FLAGGED` terminal state and increments abuse telemetry without granting a reward.
2. Guild reward concentration initially used a random metric operation id after settlement. A settlement retry could therefore double-count analytics. It now derives the metric id from the settlement operation id.
3. Granular guild permissions were initially scoped only to new social operations. They were moved into `GuildModule` and wired into legacy invite/description/role/kick/disband paths with an in-transaction re-check.
4. Finder domain errors initially escaped as generic internal errors. They are now normalized into a validated social payload error with a machine-readable reason.
5. Guild and social keyboard overlays could overlap. Both overlays now explicitly close the other one.
6. Bank operation claims originally happened before the guild row lock, so concurrent retries could surface a uniqueness error instead of replaying the completed result. Guild locking and transactional permission revalidation now happen before operation claim.
7. New guild actions originally trusted the role read before the transaction. Every protected social mutation now reloads membership and permissions under the guild lock.
8. Qualified activity, mentoring, contract/project and regional progress were initially exposed as client socket commands. Those commands were removed; only trusted backend integrations can award progress, AFK state or completion.
9. Finder block checks originally ran only before the serialized mutation. A concurrent block could race an application or acceptance, so both paths now re-check bilateral blocks inside the transaction.
10. The final semantic scan found a duplicated `existing` declaration in the guild mutation ledger path. It was removed before publication and the complete source set was rechecked.

## Tests

- `test/social-framework.spec.ts`: party sizes, role functions, readiness/freeze, qualified contributions and caps, project stages, mentoring anti-abuse, regional diminishing returns, bank limits/idempotency, guild XP levels and metrics.
- `test/group-finder-service.spec.ts`: solo, exact remote group assembly, overflow/unavailable rollback and administrator-only expansion.
- `test/guild-permission-service.spec.ts`: defaults, overrides and leader protection.
- A TypeScript parser pass covered every changed TS/TSX file, and a strict standalone compile plus a 35-assertion engine harness covered the dependency-free social domain before publication. The working environment could not install repository dependencies directly.
- The PR workflow runs Prisma validation, backend typecheck/tests and frontend typecheck/tests/build on GitHub-hosted runners.

## Deliberate boundaries

- Telemetry outbox/streaming, simulator and content feature-flag infrastructure from issue #204 remain out of scope, matching the clarification on issue #213.
- Finder roster state is durable; the active open-world group projection remains process-local by design of the existing group subsystem. A process restart can reconstruct activity intent from the frozen finder roster, but reconnect orchestration for a running expedition remains owned by issue #212.
- The social hub exposes the main flows. Bank deposit requires selecting a concrete inventory item and is currently available through the socket API; a drag-and-drop inventory-to-bank interaction can be layered on without changing server semantics.
