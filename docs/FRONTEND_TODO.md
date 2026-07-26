# Frontend Future TODO

The following work is intentionally excluded from Phase 1 business logic.

## Shared protocol and generation

- Move shared socket contracts into a versioned workspace package or generate the client types from one canonical schema.
- Add protocol-version negotiation and a visible incompatible-client upgrade screen.
- Generate map and outfit catalog metadata during CI instead of copying it manually.
- Add signed asset manifests and cache-busting content hashes.

## Combat

- Add a turn-based combat scene and action timeline driven only by authoritative battle snapshots.
- Add target selection, server deadlines, reconnect recovery, effects, damage numbers, and battle result screens.
- Prevent movement input while the server reports `IN_BATTLE`.
- Add deterministic replay tooling for support diagnostics.

## Inventory, equipment, and loot

- Replace mock grids with server inventory snapshots and revisioned mutations.
- Add drag-and-drop with optimistic presentation and authoritative rollback.
- Add stacking, splitting, tooltips, comparison panels, equipment slots, durability, rarity, and currencies.
- Add ground-loot ownership and pickup feedback.

## Stats and progression

- Replace mock HP, energy, XP, and attributes with authoritative resource and progression events.
- Add level-up presentation, outfit unlock notices, stat allocation, and derived-stat explanations.
- Add an authenticated outfit-selection command once the backend exposes it.

## Quests and NPCs

- Add NPC interaction prompts, dialogue trees, shop windows, and quest acceptance.
- Add objective trackers, map markers, completion effects, and transactional reward claims.
- Add mob and NPC scene views to the same spatial visibility pipeline as players.

## Skills and action bar

- Load class skill definitions and learned ranks from the server.
- Add drag-to-bind action slots, cooldown overlays, range previews, resource validation, and cast acknowledgements.
- Persist bindings per character and device profile.

## Chat and social systems

- Replace local mock chat with global, local, system, private, party, guild, and trade channels.
- Add message history pagination, moderation states, blocking, reporting, rate-limit feedback, and safe link handling.
- Add friends, parties, guild presence, and inspect-player actions.

## Trading

- Add invitation, two-sided offer revisions, item reservation, confirmation stages, cancellation, and final transaction receipts.
- Make every visual trade state reflect a server-issued revision to prevent stale confirmation.

## Mobile and accessibility

- Add touch joystick and tap-to-path controls.
- Add scalable HUD presets, reduced-motion transitions, high-contrast mode, screen-reader alternatives for critical notifications, and remappable controls.
- Add gamepad support through the Gamepad API.

## Performance and operations

- Replace per-tile sprites with chunked cached map containers for very large maps.
- Add asset prefetching at portal boundaries and background decompression workers.
- Add renderer metrics, WebGL context-loss recovery, crash reporting, and socket latency diagnostics.
- Add Playwright end-to-end tests against Firebase Auth Emulator and an ephemeral backend/database stack.
- Add visual regression tests for authentication, creator, HUD, minimap, and all modal breakpoints.
- Add a committed npm lockfile and dependency vulnerability scanning after registry access is available.
