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

## PVE rewards and level-gap protection

- A player receives mob experience only when the absolute difference between the player's level and the mob's level is at most 10.
- A difference of exactly 10 is allowed; a difference of 11 is rejected.
- The rule is evaluated independently for every participant, so one ineligible member does not block experience for the rest of the party.
- Experience is divided only between eligible, non-withdrawn online participants. Integer remainder is distributed one point at a time.
- Example: a level 1 mob worth 101 XP defeated by levels 1, 8 and 100 awards `51 / 50 / 0`, not `34 / 34 / 0`.
- `MobRewardService` repeats the level check against the persisted character level, providing defense in depth if another caller bypasses the group coordinator.
- Ineligible players still receive personal loot and quest kill credit because the requested restriction applies specifically to experience.
- Every rewarded participant receives an independent personal loot roll directly into their inventory.
- A full inventory only discards that player's overflow; it does not affect teammates.
- Withdrawn or disconnected actors do not receive rewards.

This is intentionally personal loot rather than a race to pick up one shared item. The experience gate is server-authoritative and cannot be bypassed by changing the client.

## New party arena asset and visual analysis

The previous background was designed around a duel and did not provide reliable visual lanes for twenty actors. A new project asset was created at:

`frontend/public/assets/combat/grand-party-arena.svg`

The asset is 1920×1080 and was designed specifically around the combat requirements:

- a high horizon leaves the lower part of the screen available for characters;
- both sides have broad, visually distinct terraces;
- each terrace contains a subtle five-position front arc and five-position back arc;
- the center remains empty for projectiles, lunges and area effects;
- the formation markers are deliberately subtle, so smaller parties do not look as though empty slots are missing players.

The SVG was rasterized locally and reviewed before the formation was finalized. A 10-versus-10 overlay was then checked against the same geometry. That review changed the implementation from a generated mathematical grid to explicit arena anchors.

The background uses `100% 100%` sizing rather than `cover`. A small amount of controlled stretching on non-16:9 displays is preferable to cropping, because cropping would make sprite and effect coordinates diverge from the painted terraces.

## Battlefield UI for up to 10 actors per team

- Every participant has an individual sprite on the ring; the roster is no longer represented by only two central substitute models.
- Actors one through five use the front arc and actors six through ten use the smaller back arc.
- The right formation is a strict mirror of the left formation.
- Group sizes adapt the sprite scale: solo actors are large, while full parties use compact front and back rows.
- Inactive actors keep a compact name and HP presentation. The active actor and selected target expose additional combat information.
- State markers such as defeated and withdrawn remain visible on compact desktop cards; the responsive low-height mode can hide the marker row while the defeated sprite remains visually dimmed.
- Living enemy sprites are the actual target controls. Selection automatically falls back when the selected actor dies or withdraws.
- The coordinate system covers the full viewport, matching the full-viewbox arena asset exactly instead of using an inset stage with different vertical percentages.
- Responsive rules reduce character dimensions on smaller displays without changing their ground anchors.

## Animation and VFX anchoring

A sprite position and an effect position are intentionally separate values:

- `x/y` anchor the unit to the painted ground location;
- `effectX/effectY` anchor the cast rune, projectile origin, impact, shockwave, support aura and floating result near the unit's torso.

This avoids the earlier failure where moving or scaling the sprite caused the projectile to miss it. The same formation map supplies both the renderer and `CombatVfx`, so there is no second set of hard-coded percentages.

- projectiles interpolate from the acting actor's effect anchor to the selected target's effect anchor;
- area skills create an impact and floating result at every affected target anchor;
- support effects remain attached to the casting actor;
- sprite scale changes do not alter effect coordinates;
- lunge motion is intentionally short and returns to the actor's original formation anchor;
- the dynamic VFX layer renders above active and selected combatants, so an impact is not hidden behind the target sprite.

## Additional UI fixes found during review

- The group kick action is visually transparent and borderless, with a separate layout position below the online indicator so it cannot cover the green status dot.
- Item tooltips measure their real rendered width and height before collision handling. They stay adjacent to the cursor instead of subtracting a hard-coded 320-pixel height and jumping toward the top of the screen.
- The victory/defeat modal uses the existing `combat.result.return` translation, replacing the missing key that rendered an empty button.

## Self-review cases

Covered by focused tests or direct code-path review:

- explicit target selection damages only that enemy;
- area skills damage every living enemy;
- one member withdrawing does not end a multi-member fight;
- a team result is produced only after the full opposing team is eliminated;
- complete groups are reserved and activated in immediate PVP;
- an available group can fight a solo player, with a dedicated 2-versus-1 regression test;
- a ten-actor team receives ten unique arena anchors;
- the right-side ground and VFX anchors mirror the left-side anchors;
- every effect anchor is above its unit's ground anchor;
- the solo formation is larger than the ten-person formation;
- target fallback works after the selected enemy is defeated;
- same-group overlap, stale membership, map changes, trades and shared PVP/PVE occupancy are rejected server-side;
- pending cancellation and server shutdown release every reservation;
- the PVE socket bridge preserves target selection instead of accidentally sending the command to the PVP event;
- a level difference of 10 grants XP and a difference of 11 does not;
- a level 100 player receives zero XP from a level 1 mob;
- party XP is divided only among level-eligible participants;
- frontend combat props remain compatible with `exactOptionalPropertyTypes`;
- client combat state is calculated per participant, so a withdrawn member returns to `IDLE` while their teammates continue fighting;
- the new `CombatVfx` contract has one call site and receives battlefield coordinates from the same formation map used to render the sprites.

## Verification limits

A complete `npm run check:all` still cannot be executed in the connector environment because a local checkout cannot resolve GitHub. The SVG was rendered and visually inspected locally before publication, and the published TypeScript/TSX, CSS and reward changes were reviewed through final branch content and pull-request patches. Focused unit tests were added. The repository currently has no GitHub workflow run for this branch, so CI validation remains unavailable until the repository runs its own checks.
