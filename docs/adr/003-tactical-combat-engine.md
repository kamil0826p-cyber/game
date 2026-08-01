# ADR 003: Tactical combat model for 1–10 actors per side

- Status: accepted for issue #206
- Contract version: 2
- Rules version: 2

## Context

The game already has one authoritative `CombatEngine` shared by PvP and PvE. The previous model supported two frozen teams and up to ten actors per side, but used a fixed 30-second turn, visual-only rows, narrow targeting, an offensive AFK fallback, and immediate disconnect forfeits. Adding a second combat implementation would split balancing, persistence and reward safety, so tactical rules are implemented inside the existing engine.

## Decision

### Boundaries and deterministic execution

`CombatEngine` remains a pure in-memory domain object. It does not import NestJS, Socket.IO or Prisma. Time and commands are passed in, and RNG is injected. `CombatSimulator` supplies a seeded RNG and can execute the same rules without infrastructure.

A combat freezes exactly two rosters at creation. Each side has 1–10 actors. Actor IDs are unique inside a side, rosters are disjoint across sides, and the anchor must belong to that side. Active places are assigned deterministically in roster order: slots 0–4 are `FRONT`, slots 5–9 are `BACK`. Repositioning swaps existing slots; it does not create free movement or an arena pathfinding system.

### Phases

1. `DECISION`: the active actor submits one authoritative command.
2. `REACTION`: a declared telegraph exposes public intent, legal responders and a deadline.
3. `RESOLVING`: the engine applies effects and advances the queue.

Request/accept and terminal lifecycle statuses remain unchanged. The roster and initiative order are stable after start. Agility plus injected RNG determines the initial queue; actor ID is the deterministic tie-breaker.

### Timing and fallback

Timing is a validated policy carried by the runtime and snapshot. Standard decision policies must stay between 8 and 12 seconds; the default is 10 seconds for a decision and 12 seconds for a reaction, while the explicit tutorial policy is longer. A short presentation grace is represented separately from the decision/reaction window, so loading and the previous resolved VFX do not reduce measured thinking time.

A timeout invokes the actor's configured fallback: `DEFEND` by default, or `BASIC_ATTACK` into a backend-generated legal target, or `SKIP`. AI and timeouts use the same legal-target generator as player validation. A disconnected active actor receives a short fallback timer; after the grace period the participant forfeits, not the entire team.

### Legal targets and formation

Targeting contract v2 contains `SELF`, `ALLY`, `ENEMY`, `ALL_ALLIES`, `ALL_ENEMIES`, `FRONT_ROW`, `BACK_ROW` and `ADJACENT`. Legacy `AREA` is accepted as an alias of `ALL_ENEMIES` for existing content.

The engine is the source of truth for legal targets. The snapshot exposes legal actions for the actors currently allowed to decide or react, so UI and AI consume the same result rather than reimplementing rules.

Warrior basic attacks and non-projectile single-target skills cannot reach a living back line while an enemy front line remains. Mages, archers, projectile skills, explicit back-row skills and all-enemy effects can reach the back. A living front actor can apply `PROTECTED` to a back actor; eligible damage is redirected to the protector and the event records both the original and actual target.

### Typed tactical operations

Queue- or legality-changing commands are a discriminated command union, not arbitrary status strings: `DEFEND`, `INTERCEPT`, `TAUNT`, `INTERRUPT`, `CLEANSE`, `MARK`, `COUNTER`, `REPOSITION`, `TRANSFER_ENERGY` and `SKIP`.

Runtime statuses are typed records with a unique ID, source, source power, duration, magnitude and application turn. Status keys remain data-driven for existing skill content, while operations with special semantics are resolved by explicit engine branches.

- `DEFEND` applies a one-cycle guard reduction.
- `INTERCEPT` protects a back-line ally from the front.
- `TAUNT` constrains PvE target priority through legal-target generation.
- `INTERRUPT` is reaction-only, consumes energy, cancels the telegraph and applies `STAGGER`.
- `CLEANSE` removes a bounded number of negative statuses.
- `MARK` applies consumable `EXPOSED`.
- `COUNTER` returns part of the next received hit.
- `REPOSITION` swaps two ally slots.
- `TRANSFER_ENERGY` moves a bounded resource amount.
- Revive is intentionally absent unless an encounter definition later enables it.

### Telegraphs, combos and hidden information

High-impact skills enter `REACTION` after costs and cooldown are committed. The public snapshot includes caster, skill label, declared target scope, eligible responders and a deadline. It does not include future RNG rolls. Legal reactions can defend, counter or interrupt. Closing the window either resolves the stored declaration or advances after interruption.

`EXPOSED` is consumed by the next heavy hit. Interrupt creates consumable `STAGGER`. A damage operation can explicitly consume `EXPOSED`, `STAGGER` or `BLEED` for a finisher. These are sequence bonuses rather than permanent composition multipliers.

### Damage, control and result events

Physical damage uses armor and optional penetration. Magical damage uses a separate magic resistance. Existing actors derive it from 35% of armor when a source does not provide an explicit value, preserving the previous balance baseline while allowing future equipment to supply it directly. Snapshots expose both effective reductions.

Repeated hard control in all-player PvP combat has diminishing returns: full, half, quarter, then rejected until the DR window expires. The action result exposes the rejection reason. Boss-specific break bars are left to encounter definitions.

Every resolved event has a monotonic sequence. Result payloads include redirects, interception, cleanses, consumed combo states, counter damage and rejected control reasons. Clients animate only these resolved events; a telegraph declaration is a public intent event, not a predicted result.

### Idempotency, reconnect and checkpointing

Client commands carry contract version, expected turn and operation ID. A repeated operation ID with the same fingerprint is a no-op and returns the current authoritative snapshot. Reusing it with another payload is rejected. A command for a previous turn is rejected before mutation.

Disconnect marks one actor and retains combat occupancy, queue, telegraph and sequence. `getActive` clears the disconnected marker and returns the full snapshot. Explicit leave still forfeits that actor. PvE reward completion is guarded by combat ID so duplicate acknowledgements cannot grant rewards twice. Shutdown terminates active combats, checkpoints player state and never executes rewards as a side effect.

### Analytics and UI

The runtime records decision durations and reports sample count, median and P95 in the snapshot. The arena consumes server formation slots, legal targets, queue, next actor, phase timing, telegraph and protection markers. Labels accompany colors. Users can suppress combat VFX while preserving state and result information.

## Consequences

- Existing skills and `AREA` content remain compatible.
- Both PvP and PvE services keep one engine and one event shape.
- New skill definitions can use ally and row targeting without frontend trust.
- Runtime state is larger, but bounded histories (96 events, 256 operation IDs, 512 timing samples) prevent unbounded growth.
- The in-memory service still requires the existing shutdown checkpoint path; durable mid-combat recovery across a full process restart remains a later persistence decision.
