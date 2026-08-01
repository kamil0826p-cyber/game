# PvE encounter self-review addendum

This addendum records the final review work added after the original `PVE_ENCOUNTER_SELF_REVIEW.md` was written.

## Final corrections

- The 10-player Kat tier now starts with seven enemies and reaches exactly ten after its three bounded phase summons.
- Encounter phase transitions emit an explicit `encounter:phase` combat event and visual cue even when a phase has no summon.
- Phase conditions support turn, aggregate enemy HP, actor HP, actor defeat, telegraph result, active status, break/stagger threshold, living-player count and explicit encounter interaction.
- `DEFEAT_ACTOR` victory and `TURN_LIMIT` defeat are enforced by normal `CombatEngine` operations. Objective victories are normalized to the existing defeated-enemy reward path.
- Timeout-generated fallback actions are excluded from both contribution score and activity ratio.
- Reward replay protection uses the dedicated `EncounterRewardLedger`; the currency ledger is not reused because its database constraint requires a positive amount.
- Catalog validation now checks the single world-root actor invariant, root presence in every tier, role consistency, telegraph ownership, phase-trigger references, exact 1/3/5/10 tiers, rank coverage and the maximum possible ten-enemy composition.

## Final unit-test coverage authored

`test/encounter-framework.spec.ts` covers:

- valid built-in encounter versions and invalid author content;
- meaningful 1/3/5/10 scaling and exact 7+3 enemy capacity;
- leader/frontline/backline/support actor construction;
- deterministic AI plans and deterministic engine results for the same seed and state;
- telegraph declaration, legal interrupt, stagger, recorded telegraph result and phase transition;
- status and explicit-interaction phase triggers;
- three phases, bounded summons and phase events;
- objective victory and turn-limit defeat;
- support contribution plus AFK and late-participation exclusion.

`test/encounter-reward-idempotency.spec.ts` covers returning an already stored settlement without recomputing progression or progressing quests again.

## CI evidence

GitHub Actions created jobs for this branch, but each inspected job ended with `startup_failure` before any step executed. The job-step response was empty and no logs were produced. This is not evidence that typechecking, tests or builds passed or failed. The pull request therefore remains a draft until a runner executes `npm run check:all`.
