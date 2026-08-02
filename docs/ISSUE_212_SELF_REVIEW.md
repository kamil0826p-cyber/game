# Issue #212 — implementation and self-review

## Scope

This change implements the first production slice of persistent expeditions and ritual hunts for legal parties of 1–10 players. It follows the product direction from audit #203: preparation, authored choices, visible risk, consequences, deterministic variation and extraction replace respawn waiting as the primary loop.

The implementation deliberately does not copy an existing pull request. It is built against the current `main` contracts for groups, itemization, narrative state, skills and the shared PvE encounter runtime.

The telemetry/outbox/simulator/content-flag work from #204 is not duplicated here because issue #212 explicitly marks it as non-blocking for this task.

## Architecture

### Versioned authored content

- `ExpeditionDefinition` stores stable identity, version, content version, party limits, entry conditions, preparation cost, risk profiles, resources, encounter and loot pools, graph nodes, checkpoint policy, reward policy, difficulty mechanics and broad rotation policy.
- The built-in `ashen-pilgrimage@1` graph contains two initial branches and authored combat, boss, event, investigation, ritual, cache, rest, hazard, limited run service, extraction and conditional oath gate nodes.
- The catalog validator rejects invalid identities, illegal party sizes, actor overflow above 10, missing encounters/items/resources, invalid terminal nodes, unreachable nodes, routes trapped without extraction, missing required node categories and FOMO-prone rotation windows.

### Frozen persistent run

- A run persists the full definition snapshot, definition/content version, signed deterministic seed, accepted risk snapshot, frozen party, roles, formation, active combat loadouts, equipment IDs, consumables/tools, resources, route history, operation IDs, pending/secured loot, contributions and consequences.
- `ExpeditionActiveMember` enforces one preparing/active expedition per character.
- Existing runs never read mutable catalog content after creation.
- Every state mutation locks the run row, checks revision, claims a unique operation ID and commits the snapshot plus operation result in one serializable transaction.

### Preparation and loadout lock

- Preparation snapshots the actual active `SkillService.getCombatLoadout()` result rather than all learned skills.
- The database prevents equipped-slot changes and skill-build changes while a character belongs to a preparing or active expedition. Cooldown persistence remains allowed.
- The lobby discloses the locked fields before confirmation.
- Roles are declarative and are not restricted by character class.

### Authoritative PvE integration

- The mob claim path validates the complete current group against the frozen expedition party and pending encounter. A partial, changed or mixed party cannot use an expedition encounter or ordinary mob rewards.
- Ritual choices alter actual encounter AI policy, stat scale, telegraph counters, arena modifiers and phase mechanics.
- The ordinary open-world reward path is suppressed only when the authoritative encounter result belongs to an active expedition.
- Runtime contribution data is copied into the run report: actions, timeouts, damage, healing, protection, interrupts, cleanses, mechanics, score and eligibility.

### Loot and terminal settlement

- Pending loot remains JSON state inside the run and is never an `InventoryItem` before terminal settlement.
- Checkpoints move only the accepted deterministic portion to secured loot.
- Failure/abandonment retains pending loot according to the frozen risk profile; insurance reduces loss and consequence severity.
- Extraction, completion, failure and abandonment settle in one database transaction.
- `ItemInventoryService.grant(..., claimOverflow: true)` sends overflow to the claim queue.
- Currency and item operations have stable ledger operation IDs, and `ExpeditionRewardLedger` prevents a second personal settlement.
- Permanent equipment and character level are never removed by expedition failure.

### Reconnect and shutdown

- Every successful mutation persists the complete run snapshot.
- `expedition:get` restores the active run, or the latest terminal report, for a reconnecting member.
- The existing PvE disconnect policy remains authoritative during combat.
- The checkpoint policy is `PERSIST_ONLY`: server shutdown does not manufacture a terminal reward; the persisted run and pending encounter remain resumable.

### UI

The overlay provides:

- catalog and preparation lobby;
- formation and per-member declarative roles;
- risk/difficulty/insurance preview with explicit acceptance;
- frozen loadout and lock disclosure;
- discovered route map and leader decisions;
- resources, modifiers, consequences and ritual choices;
- pending versus secured loot;
- reconnect state and terminal actions;
- terminal outcome, duration, economy, route history, decisions and team contribution.

## Tests

`test/expedition-framework.spec.ts` covers:

- catalog validation and illegal authored content;
- all legal party sizes 1–10;
- immutable definition/risk/loadout/party snapshots;
- deterministic operation replay and deterministic deep-route results;
- mandatory immutable ritual choice and real encounter variant changes;
- checkpoint security, risk loss, insurance and consequences;
- hidden route intelligence and seed non-disclosure;
- conditional oath route;
- terminal request idempotency;
- final duration/economy/contribution report;
- broad rotation with core rewards preserved.

Targeted temporary local verification harness (not committed) run before publication:

```text
npx tsc -p tsconfig.core.json
npx tsc -p tsconfig.tests.json
npx tsc -p tsconfig.expedition.json
node smoke.mjs
node self-review-smoke.mjs
isolated frontend expedition TypeScript check
TypeScript syntax checks for GameConnectionProvider and GameScreen integration
```

The real repository CI remains the source of truth for generated Prisma types, Vitest, ESLint, frontend build and the complete `npm run check:all` pipeline.

## Self-review findings fixed

1. A ritual node could be left without committing a ritual choice.
2. A one-item percentage split always rounded against the player instead of deterministically.
3. The public view could expose deterministic internals if the full snapshot leaked.
4. Insurance was initially metadata-only and did not reduce real loss or consequences.
5. Difficulty descriptions were stronger than their mechanics.
6. Ritual preparation initially changed only labels rather than encounter behavior.
7. The authored graph initially omitted investigation, event, rest and limited service categories.
8. The terminal view initially omitted the required duration/economy report.
9. An unsigned seed could exceed PostgreSQL `INTEGER`.
10. Reusing a preparation operation ID with a different payload could return the wrong run.
11. Reusing one operation ID for another operation kind was not rejected.
12. Auto-resolution could leave the outer operation ledger with a stale revision/result.
13. An expedition member could receive ordinary mob rewards by fighting outside the pending encounter.
14. Mob state could remain claimed if expedition settlement failed.
15. A changed or partial party could attempt an expedition encounter because only the initiator was checked.
16. The frontend socket helper used an unsafe union-event abstraction that conflicted with typed overloads.
17. A terminal report had no path back to a fresh preparation flow.
18. Route controls remained clickable while a ritual choice was unresolved.
19. The first loadout snapshot used learned skills instead of the active combat loadout.
20. The lobby lacked formation and per-member role controls.
21. The report lacked actual encounter contribution data.
22. Lobby copy said the lock began after start although the safety lock begins when the lobby is created.

## Remaining dependency boundary

Issue #204 reporting is intentionally not reimplemented. Expedition reward ledgers and source metadata are present so the future economy pipeline can classify expeditions as a separate source without changing terminal semantics.
