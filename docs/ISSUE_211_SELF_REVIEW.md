# Issue 211 self-review

## Scope implemented

- Versioned reactive narrative definitions with an immutable definition snapshot stored on each active quest.
- Typed conditions, objectives, effects, choices and terminal outcomes; content cannot execute code or SQL.
- One shared condition evaluator for character, inventory, quest, consequence, guild, party, region, cycle and encounter state.
- Server-authoritative objective events with stable operation IDs and replay-safe results.
- Atomic, row-locked quest choices with idempotency records and a safe public projection.
- Fail-forward branches that preserve the story snapshot and prior choices.
- Character flags, NPC relations, faction reputation, hostile-faction constraints and diminishing repeatable gains.
- Region state with revisioning, anti-AFK/qualification checks, minimum contribution and character/group/guild caps.
- Audit records with an operation key, event type and reason.
- Journal/chronicle projection containing only decisions already made and their final outcome.
- Authoring validation, path simulation and definition-version diff helpers.
- Compatibility layer for the existing quest objective format plus a reactive `{ version, objectives, narrative }` format.

## Persistence and concurrency review

- Personal narrative state is namespaced under `Character.progressionData.narrative`; unrelated progression and consequence data are preserved.
- Active quest snapshots and replay caches are namespaced under `CharacterQuest.progress.narrative`.
- Choices lock the `CharacterQuest` row with `FOR UPDATE` before reading or mutating narrative progress.
- `NarrativeOperation(scopeKey, operationId)` is the database idempotency boundary for choices, authoritative events and audits.
- Region updates lock a single `NarrativeRegionState` row and increment its revision in the same transaction.
- Character state uses `progressionVersion` optimistic concurrency and increments `stateVersion`; the live session is synchronized after commit.
- Narrative tables are declared in `prisma/narrative.prisma`; Prisma configuration now loads the schema folder, preventing migration/schema drift.

## Security and information-boundary review

- Client-facing views include only the current node, current objectives, currently eligible choices, disclosed effects and past chronicle entries.
- Definition snapshots and future nodes are never returned by the gateway.
- Hidden effects are rejected by validation when they change reputation, relations, resources, access, consequences, quest state, region state or terminal outcome.
- Socket payloads use strict schemas and require an active in-world session.
- All SQL statements are static tagged Prisma queries; narrative content is only bound as data.

## Self-review fixes made

1. Fixed retry handling so an already completed choice returns the stored result instead of falling through an incompatible transaction result shape.
2. Synchronized session silver and persistence revisions after committed narrative resource effects.
3. Made quest progress comparison include the narrative snapshot, so snapshot repair is persisted even when legacy counters do not change.
4. Prevented quest turn-in until a reactive narrative has reached a terminal outcome.
5. Added an explicit chronicle projection so reconnects show past decisions without exposing future branches.
6. Moved new Prisma models into a multi-file schema rather than leaving migration-only tables.
7. Removed database foreign keys from audit/aggregate tables because the new domain file intentionally does not modify relation fields in core models; IDs remain indexed and cleanup can be handled by domain retention policy.

## Verification performed before publication

- Strict TypeScript compilation of all pure narrative modules.
- Syntax compilation of Nest/Prisma integration, quest integration and unit test files.
- Executed Node smoke tests for definition validation, choice/outcome transition, chronicle projection, region caps and idempotent replay.
- Added Vitest unit suites for validator failures, immutable version snapshots, authoritative progress, idempotent choices/events, fail-forward, safe projections, faction/relationship rules, region anti-abuse, shared conditions and quest-content compatibility.

## Remaining review gates

- Full repository `npm run typecheck`, `npm test` and `prisma validate` must run in repository CI because this execution environment does not have the project dependencies installed.
- The current `main` still contains the merged #210 source payload under `.upload`; this implementation deliberately uses the shared typed consequence contract and namespaced state rather than copying code from another pull request. The PR should remain draft until the repository materialization/CI path confirms the complete combined tree.
- Runtime adapters for every future merchant, portal and encounter definition should call the exported shared evaluator; this PR establishes the single evaluator and narrative gateway/service, while existing legacy definitions remain unchanged.
