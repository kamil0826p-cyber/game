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
- Team sizes are independent. Group-versus-group, group-versus-solo and solo-versus-group use the same flow and do not require equal numbers.
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

## Battlefield UI for up to 10 actors per team

- Every participant now has an individual sprite on the ring; the roster is no longer represented by only two central substitute models.
- Each side uses a deterministic formation: up to five actors in the front row and actors six through ten in a smaller back row.
- The two formations are mirrored and keep a clear central lane even in a 10-versus-10 fight.
- Every sprite has its own name, level, HP, energy, active-turn marker, selected-target marker and defeated/withdrawn state.
- Living enemy sprites are the actual target controls. Selection automatically falls back when the selected actor dies or withdraws.
- Attack movement, projectiles, impact bursts, shockwaves, support effects and floating values are positioned from the acting sprite to the actual target sprite.
- `AREA` actions produce impacts and floating results on every affected enemy sprite.
- The victory/defeat modal uses the existing `combat.result.return` translation, replacing the missing key that rendered an empty button.
- The challenge modal still shows both frozen roster sizes and names.
- The existing action bar, keyboard shortcuts, VFX queue and combat log remain the single implementation for PVP and PVE.

## Additional UI fixes found during review

- The group kick action is visually transparent and borderless, with a separate layout position below the online indicator so it cannot cover the green status dot.
- Item tooltips measure their real rendered width and height before collision handling. They now stay adjacent to the cursor instead of subtracting a hard-coded 320-pixel height and jumping toward the top of the screen.

## Self-review cases

Covered by focused tests or direct code-path review:

- explicit target selection damages only that enemy;
- area skills damage every living enemy;
- one member withdrawing does not end a multi-member fight;
- a team result is produced only after the full opposing team is eliminated;
- complete groups are reserved and activated in immediate PVP;
- an available group can fight a solo player, with a dedicated 2-versus-1 regression test;
- a ten-actor team receives ten unique formation slots and both sides remain on their own half of the arena;
- target fallback after the selected enemy is defeated;
- same-group overlap, stale membership, map changes, trades and shared PVP/PVE occupancy are rejected server-side;
- pending cancellation and server shutdown release every reservation;
- the PVE socket bridge preserves target selection instead of accidentally sending the command to the PVP event;
- Nest module imports were checked for a `CombatModule` / `MobModule` / `MovementModule` cycle;
- frontend combat props remain compatible with `exactOptionalPropertyTypes`;
- client combat state is calculated per participant, so a withdrawn member returns to `IDLE` while their teammates continue fighting; this has a dedicated regression test;
- the new `CombatVfx` contract has one call site and receives battlefield coordinates from the same formation map used to render the sprites.

## Verification limits

A complete `npm run check:all` still cannot be executed in the connector environment because a local checkout cannot resolve GitHub. The published TypeScript/TSX and CSS changes were reviewed through the final branch content and pull-request patches, and focused unit tests were added. The repository currently has no GitHub workflow run for this branch, so CI validation remains unavailable until the repository runs its own checks.
