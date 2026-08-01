# Issue 211 implementation plan

This branch implements the reactive narrative foundation described in issue #211.

## Dependency preflight

The current `main` contains the already-merged #210 source package under `.upload`. The pull-request materialization workflow must restore that package on this branch before narrative code is changed, preventing #211 from being built against an incomplete dependency.

## Safety constraints

- Build from the current `main` branch and the already-merged #210 consequence domain.
- Keep client messages non-authoritative; narrative progress is driven by server-side events.
- Snapshot story definition version and public player view on active quest instances.
- Make choices and shared-state contributions atomic and idempotent.
- Validate all content operations; definitions cannot execute arbitrary code or SQL.
- Preserve existing quest rewards, `prisma:prepare`, and current PvE/PvP behavior.

## Delivery slices

1. Typed story definitions, conditions, effects, outcomes, objectives, and validator.
2. Persistent character flags, NPC relations, faction reputation, region state, audit events, and choice operations.
3. Shared condition resolver and transactional narrative service.
4. Quest integration with version snapshots, choices, fail-forward outcomes, and safe log projection.
5. Unit tests, schema validation, typecheck, and self-review.
