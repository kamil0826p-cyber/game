# PvE encounter framework — self-review for issue #207

## Scope reviewed

This review covers the implementation on `agent/pve-encounters-207` against the acceptance criteria of issue #207 and the product direction from issue #203. It intentionally does not copy code from other pull requests. The implementation was written against the current `main` combat, group, mob, reward and frontend contracts.

## Architecture decision

There is still one authoritative `CombatEngine` for PvP and PvE. Encounter code owns content and orchestration only:

- versioned definitions, validation and author dry runs;
- actor templates, roles and party-size scaling;
- deterministic AI planning from `CombatEngine.legalActions()`;
- phase transitions, bounded roster additions and arena metadata;
- contribution and reward eligibility;
- encounter presentation data.

Every attack, skill, reaction and tactical command is submitted through `CombatEngine.act()`. Encounter summons are converted to normal `CombatRuntimeActor` records in the same bounded runtime, use the same skills/statuses/turn queue and can only act through the shared engine afterward. No second damage, cooldown, target or status resolver exists.

## Invariants checked

### Content safety

- Encounter identity is stable as `key + version`.
- The catalog is validated during mob module startup.
- Actor, skill, phase and summon references must exist.
- Scaling tiers must exist exactly for 1, 3, 5 and 10 players.
- A tier plus all possible summons cannot exceed ten enemies.
- Strong actions require a declared telegraph and counterplay or an explicit unavoidable exception.
- The first phase is unconditional; later phases require reachable transition conditions.

### Party scaling

Scaling changes mechanics, not only statistics:

- 1 player: leader-only baseline and no summon allowance;
- 3 players: front guard and one summon;
- 5 players: support/telegraph role and two summons;
- 10 players: full role roster, back-line pressure and three summons.

Health, power and rewards also scale, but independently from actor count, telegraph targets, break capacity, target turns and mechanic tags.

### AI legality and determinism

- RNG is seeded from encounter/combat/turn/actor/phase data.
- Repeating the same state produces the same plan.
- AI chooses only actions returned by `CombatEngine.legalActions()`.
- The final command is still validated by `CombatEngine.act()` for target, cost, cooldown, turn, phase and contract version.
- The bounded AI trace records the role, target policy and reason for each plan without leaking future RNG outcomes to clients.
- Reaction-capable mobs can defend or interrupt a player telegraph using the same reaction window as players.

### Phases, formations and summons

- Initial enemy formation preferences are applied before the first broadcast.
- Front and back slots use the existing ten-slot combat model.
- Phase transitions are monotonic and advance at most one phase per synchronization pass.
- Summons use deterministic actor IDs and cannot duplicate an existing actor.
- Summons are added to the existing team and turn queue; the ten-actor team limit is checked again at runtime.
- A synthetic resolved event announces the summon to the normal combat event stream and UI animation queue.

### Contributions and rewards

- Damage, healing, shields/protection, cleanses, interrupts and mechanic actions contribute to eligibility.
- Timeout-generated fallback actions are explicitly excluded from contribution and activity counts.
- Withdrawn, late, inactive and zero-contribution participants can be excluded with a reason.
- Support contribution is not reduced to damage dealt.
- The encounter reward multiplier is applied before party XP splitting.
- Personal loot remains independently rolled per eligible character.
- Reward settlement is stored transactionally in a dedicated `EncounterRewardLedger` with unique character/operation and character/combat constraints.
- A replay reads and returns the stored settlement; it does not reroll loot, add experience, insert inventory items or progress the kill quest again.

The dedicated table was added during self-review after verifying that `CharacterCurrencyLedger` enforces `amount > 0` and therefore must not be misused for zero-value idempotency records. The operation namespace remains `encounter:<combatId>`.

### World lifecycle

- Only the clicked persistent mob row is claimed in the open world.
- Additional encounter actors are combat-only and never become independent world respawns.
- Player defeat, forfeit and cancellation release the root claim.
- Victory despawns the root mob once, frees its collision tile and starts its existing per-instance respawn timer.
- Shutdown terminates active combats, releases root claims and checkpoints players without paying rewards.
- Existing occupied-tile respawn retry behavior remains unchanged.

## Automated test coverage

`test/encounter-framework.spec.ts` covers:

1. validation of all built-in encounter versions;
2. 1/3/5/10 dry-run profiles and mechanic differences;
3. construction of leader/front/back/support actors;
4. deterministic AI and legal-action membership;
5. three phase transitions and bounded summons;
6. support contribution, AFK and late-participation eligibility;
7. rejection of missing skills, unreachable phases and strong actions without telegraphs.

`test/encounter-reward-idempotency.spec.ts` verifies that a stored settlement is returned without recomputing progression or recording the quest kill again.

The PR contains a workflow for the repository-wide backend typecheck/tests plus frontend typecheck/tests/build. Its first GitHub Actions job failed during startup before any command step ran, so that startup failure is not treated as a test result.

## Risks found during self-review

### 1. Durable mid-combat restart recovery

The shared combat runtime remains in memory. A process restart releases/rebuilds world mobs but does not resume a half-finished encounter. This is pre-existing architecture and is not expanded here. Durable combat checkpoints, outbox/inbox processing, telemetry and feature flags belong to deferred issue #204.

### 2. Author tooling surface

The validator and typed dry-run report are available as code and tests, but there is no web editor or admin command yet. Invalid committed content still fails fast at startup and in unit tests.

### 3. Arena modifiers

Arena modifiers are currently authoritative phase metadata and UI labels. They deliberately do not invent a second damage ruleset. Future modifiers that alter legal actions or damage must be implemented as typed `CombatEngine` operations, not as arbitrary encounter-side mutations.

### 4. Contribution thresholds

Initial thresholds are conservative and intended to prevent obvious AFK/replay abuse. Production tuning needs telemetry from deferred issue #204. The score remains explainable and the eligibility reason is emitted to the affected player.

### 5. Reward delivery recovery

The settlement itself is atomic and replay-safe. Automatic retry/outbox delivery after a process failure between database commit and client notification remains part of the deferred reliability work in issue #204.

## Manual regression checklist

- Start a solo fight against a Pomiot: one leader, no summon wave.
- Start a three-person fight: front guard appears and one phase summon is allowed.
- Start a five-person Kat fight: support starts in the back line and `mage-meteor` opens a reaction window.
- Interrupt or defend against the meteor and verify the normal combat log/VFX sequence.
- Force both later phases and verify the encounter banner, arena modifier and bounded roster.
- Disconnect and reconnect one player; verify the same encounter snapshot returns.
- Forfeit one player; verify the remaining group continues and the withdrawn player is ineligible.
- Finish the fight, replay the completion path and verify inventory/XP/quest progress changes only once.
- Restart during an active encounter and verify the root world mob is not left permanently claimed.
