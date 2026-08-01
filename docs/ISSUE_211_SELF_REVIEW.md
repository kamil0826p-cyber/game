# Issue 211 self-review

## Scope implemented

- Versioned reactive narrative definitions with immutable definition and reward-profile snapshots on each active quest.
- Typed conditions, objectives, effects, choices and terminal outcomes; content cannot execute code or SQL.
- A shared condition evaluator plus deterministic priority-based dialogue-root resolution.
- Server-authoritative objective events with stable operation IDs and replay-safe results.
- Atomic, row-locked quest choices with database idempotency records and a safe public projection.
- Fail-forward branches that preserve the story snapshot and prior choices.
- Character flags, NPC relations, faction reputation, hostile-faction constraints and diminishing repeatable gains.
- Region state with revisioning, qualification/anti-AFK checks, minimum contribution and character/group/guild caps.
- Audit records with operation key, event type and reason, plus terminal-outcome analytics without dialogue text.
- Journal/chronicle projection containing only decisions already made, current objectives, relation/reputation summaries and current-region contribution state.
- Authoring validation, path simulation, canonical definition diff and active-snapshot migration dry-run.
- Compatibility with the existing quest objective array and the reactive `{ version, objectives, narrative }` format.
- Outcome-specific quest rewards resolved from the immutable active snapshot, with legacy rewards as the fallback.

## Persistence and concurrency review

- Personal narrative state is namespaced under `Character.progressionData.narrative`; unrelated progression data is preserved.
- Active quest snapshots and replay caches are namespaced under `CharacterQuest.progress.narrative`.
- Mutations lock the `CharacterQuest` row and then the `Character` row before evaluating state and applying effects.
- `NarrativeOperation(scopeKey, operationId)` is the database idempotency boundary for choices, events, audits and analytics.
- Effect audits use a request-specific scope, preventing collisions with the primary operation record and allowing repeatable stories.
- Currency and region effect IDs are deterministic SHA-256-derived keys, preventing retries from applying an effect twice without exceeding database key lengths.
- Region updates lock one `NarrativeRegionState` row and increment its revision in the same transaction.
- Character state uses `progressionVersion` optimistic concurrency and increments `stateVersion`; live sessions are synchronized after commit and remain marked dirty for normal persistence.
- Narrative tables are declared in `prisma/narrative.prisma`; Prisma configuration loads the schema folder, keeping migration and schema definitions aligned.

## Security and information-boundary review

- Client views include only the current node, current objectives, eligible choices, disclosed effects, past chronicle entries and player-visible state summaries.
- Definition snapshots, future nodes, source-count anti-abuse data and hidden effects are not returned by the gateway.
- Unknown runtime conditions fail closed.
- Hidden effects are rejected when they modify relations, reputation, resources, access, consequences, quest state, region state or terminal outcome.
- Objective definitions must use the authoritative server event assigned to their objective type.
- Socket payloads use strict schemas and require an active in-world session.
- All SQL statements are static tagged Prisma queries; narrative content is only bound as data.

## Self-review fixes made

1. Replays now return stored results with an empty effect list, preventing choice/event/fail-forward effects from being applied twice.
2. Objective-completion effects and terminal-outcome effects are now returned and committed for authoritative events and fail-forward transitions.
3. Immediate terminal nodes are resolved on entry instead of requiring an extra event.
4. Quest and character rows are both locked before evaluating choice conditions and applying effects.
5. Effect audit scopes no longer collide with the request operation; ledger and region keys are deterministic and bounded.
6. Live session synchronization no longer clears unrelated dirty state.
7. Quest progress comparison includes the narrative snapshot, so snapshot repair is persisted even when legacy counters do not change.
8. Reactive quest turn-in and READY state require both legacy objectives and a terminal narrative outcome.
9. Outcome-specific rewards are read from the immutable definition snapshot, so a content rollback cannot change an active quest reward.
10. Public chronicle/state projection supports reconnects without exposing future branches.
11. Nested definition changes and reward-profile changes are detected by canonical authoring diffs.
12. Added dry-run validation for migrating an active snapshot to a newer definition.
13. Unknown condition/effect/objective types, mismatched authoritative event types, invalid reward profiles and missing abandonment policies are rejected.
14. New Prisma models live in the multi-file schema rather than existing only in a migration.

## Verification performed

- Strict TypeScript compilation passed for all pure narrative modules.
- Syntax compilation passed for Nest/Prisma integration, quest integration and both Vitest files.
- Executed Node smoke tests covering definition validation, nested diff, migration dry-run, authoritative effects, idempotent retries, choices/outcomes, fail-forward, safe public projection, region caps and region replay.
- Added Vitest suites for validator failures, immutable version/reward snapshots, authoritative progress, idempotent choices/events, fail-forward, hidden-effect boundaries, public state projection, faction/relationship rules, region anti-abuse, shared conditions, dialogue priority, authoring diff/migration and quest-content compatibility.

## Unavailable verification and remaining gates

- Full `npm run typecheck`, `npm test`, `npm run prisma:validate` and frontend checks could not run locally because project dependencies are unavailable and outbound DNS is disabled.
- GitHub Actions runs `30707541588` and `30707541601`, including their failed-job reruns, ended before `checkout`: the jobs report no steps and no usable logs. They did not produce a code/test failure that can be debugged from this branch.
- The current `main` still contains the merged #210 source payload under `.upload`. The direct consequence-service adapter must be verified after that source is materialized; this branch deliberately does not copy code from the earlier pull request.
- Existing merchant, portal, encounter, party and world-cycle modules still need thin adapters that populate the shared resolver context.
- The safe backend gateway projection is present, but the frontend journal/choice UI is not included in this backend-focused change set.
- Region contribution is deterministic and idempotent, but a scheduled end-of-phase settlement/reward job remains a separate integration step.
