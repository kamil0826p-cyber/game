# Group combat — implementation and self-review

## Audit result

The existing combat stack already had the correct separation of responsibilities:

- `CombatEngine` owns deterministic, server-authoritative turn resolution, damage, energy, cooldowns, statuses and the action log.
- `CombatService` coordinates player-versus-player policy, consent, persistence and world-state publication.
- `PveCombatService` coordinates mob claims, automatic mob turns and combat completion.
- `MobCoordinatorService` owns mob lifecycle, despawn, rewards and respawn.
- the frontend already used one `CombatArena` for PVP and PVE, while `mobSocketBridge` routed the command to the correct socket event.

The group implementation extends these points instead of creating another combat engine or another combat overlay.

## Team rules

- A combat contains exactly two teams; each team contains between 1 and 10 actors.
- When an anchor player starts a fight, the roster is built from online, idle group members on the same realm and map.
- Offline members, members on another map, members already fighting and members currently trading are not added.
- The anchor must always be eligible. Otherwise the request fails.
- The roster is frozen for that combat. New group members do not join an already-created challenge.
- A player cannot attack another member of the same group; the server repeats this authorization check.
- In an OUTLAW zone only the directly challenged anchor accepts or rejects. On acceptance every reserved teammate enters the arena.
- In a PVP zone both available teams enter immediately.
- In PVE only the initiating player must be adjacent to the mob; available teammates on the same map join automatically.

## Turn engine

- Initiative is calculated once for every actor and produces a stable turn order.
- Dead or withdrawn actors are skipped without rebuilding the queue.
- Basic attacks and `ENEMY` skills hit the explicitly selected living opponent.
- `AREA` skills now resolve against every living enemy. Previously their descriptions said “all enemies”, but the two-actor engine effectively applied them once.
- `SELF` skills still target the caster.
- Cooldowns, energy, shields, damage-over-time effects, stuns and the existing animation metadata are reused unchanged.
- A team wins only when every actor on the opposing team is dead or withdrawn.
- Withdrawing or disconnecting removes one actor. The fight continues while that actor's team still has a combat-capable member.

## Shared occupancy and race prevention

PVP and PVE previously maintained separate actor-to-combat maps. That allowed a narrow race where an actor reserved by an outstanding PVP challenge could start PVE before the challenge was accepted.

`CombatOccupancyService` is now the shared reservation source for both coordinators:

- reserve is synchronous and all-or-nothing;
- PVP and PVE reject an actor reserved by either mode;
- individual withdrawal releases only that actor;
- terminal combat releases the complete roster;
- pending challenges also release every reservation on decline, expiry, cancellation and shutdown.

## PVE rewards

- Experience from the mob is divided exactly across non-withdrawn online participants; integer remainder is distributed one point at a time.
- Every eligible participant receives a personal loot roll directly into their inventory.
- Quest kill credit is recorded independently for every rewarded participant by the existing reward service.
- A full inventory only discards that player's overflow; it does not affect teammates.
- Withdrawn or disconnected actors do not receive rewards.

This is intentionally personal loot rather than a race to pick up one shared item. It is inspired by party-oriented MMORPG loot, but is explicitly defined here so the economy behavior is deterministic.

## UI for up to 10 actors per team

- Both teams are shown as compact rosters on the left and right.
- Rosters use one column for up to five actors and two columns for six to ten actors.
- Every card shows outfit, name, level, HP, energy, statuses and active/defeated/withdrawn state.
- Only the acting actor and selected target are rendered at full size in the center, preserving the existing large combat animations.
- Living enemy cards can be selected as targets. The selection automatically falls back when the target dies or withdraws.
- The turn banner distinguishes the local player's turn, an ally turn and an enemy turn.
- The challenge modal shows both frozen roster sizes and names.
- The existing action bar, keyboard shortcuts, VFX queue and combat log remain the single implementation for PVP and PVE.

## Self-review cases

Covered by focused tests or direct code-path review:

- explicit target selection damages only that enemy;
- area skills damage every living enemy;
- one member withdrawing does not end a multi-member fight;
- a team result is produced only after the full opposing team is eliminated;
- the local/enemy roster split and 10-person two-column layout rule;
- target fallback after the selected enemy is defeated;
- complete groups are reserved and activated in immediate PVP;
- same-group overlap, stale membership, map changes, trades and shared PVP/PVE occupancy are rejected server-side;
- pending cancellation and server shutdown release every reservation;
- the PVE socket bridge preserves target selection instead of accidentally sending the command to the PVP event;
- Nest module imports were checked for a `CombatModule` / `MobModule` / `MovementModule` cycle;
- frontend roster props were hardened for `exactOptionalPropertyTypes` so explicit `undefined` identifiers remain type-safe.

## Verification limits

A complete `npm run check:all` still cannot be executed in the connector environment because a local checkout cannot resolve GitHub. The prepared TypeScript and TSX changes were parsed with the installed TypeScript compiler before publication, the published diff and module wiring were reviewed, and focused unit tests were added. The repository currently has no GitHub workflow run for this branch, so CI validation remains unavailable until the repository runs its own checks.
