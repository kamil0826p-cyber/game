# Issue 211 implementation plan

This branch implements the backend foundation for the reactive narrative system described in issue #211.

## Dependency boundary

The current `main` contains the already-merged #210 source package under `.upload`, while the source-materialization workflow currently fails before `checkout`. This branch does not copy implementation from another pull request. It defines a typed consequence boundary and stores narrative state in a separate `progressionData.narrative` namespace so the direct #210 adapter can be attached after the merged package is materialized.

The pull request remains draft until the complete combined tree can pass repository CI.

## Safety constraints

- Build from the current `main` branch.
- Keep client messages non-authoritative; progress is driven by server-side events.
- Snapshot the story definition and reward profiles on active quest instances.
- Lock quest and character rows before evaluating and committing a choice.
- Make choices, authoritative events, effects and region contributions idempotent.
- Validate content operations; definitions cannot execute arbitrary code or SQL.
- Preserve the existing quest objective format and reward behavior for legacy quests.
- Do not expose future branches, hidden effects or player dialogue text in public views or analytics.

## Delivery slices

1. Typed story definitions, conditions, effects, outcomes, objectives and fail-closed validation.
2. Persistent character flags, NPC relations, faction reputation, region state, audit events and operation IDs.
3. Shared condition/dialogue resolver and transactional narrative service.
4. Quest integration with immutable version/reward snapshots, choices, fail-forward outcomes and safe journal projection.
5. Authoring tools for graph validation, path simulation, definition diff and snapshot migration dry-run.
6. Unit tests, smoke tests and self-review.

## Explicit follow-up gates

- Materialize and attach the direct #210 consequence service adapter.
- Wire existing merchant, portal, encounter, party and world-cycle providers to the shared condition context.
- Add the frontend journal/choice presentation using the safe gateway projection.
- Run the full repository typecheck, Vitest, Prisma validation and frontend suite when GitHub Actions can start jobs normally.
