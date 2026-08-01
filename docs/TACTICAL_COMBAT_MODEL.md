# Tactical combat model v1

## Scope and invariants

There is one authoritative `CombatEngine` for PvP, PvE and deterministic simulation.
Every combat has exactly two teams with one to ten actors on each side. `COMBAT_TEAM_LIMIT`
remains `10`; ordinary group size is not encoded as an engine restriction.

The client never predicts damage, legal targets, interrupts or fallback results. It renders the
server snapshot and ordered action resolutions. The tactical additions extend the existing arena
and action bar; they do not introduce a second combat modal or a parallel rules engine.

## State machine

A combat moves through the following phases inside the existing lifecycle status:

1. `REQUEST` — PvP consent/request or immediate PvE engagement.
2. `TURN` — the active actor chooses an ordinary or tactical action.
3. `REACTION` — an announced skill is waiting for legal counters.
4. `FINISHED` — no more commands are accepted.

`turnNumber`, `turnOrder`, `lastSequence`, the optional telegraph, formation and every participant
state are part of the snapshot. A reconnect therefore reconstructs the current choice window
without replaying hidden server memory.

## Timing and safe fallback

Environment configuration:

- `COMBAT_TURN_TIMEOUT_MS` — ordinary decision window, default `10000`, allowed `3000–60000`;
- `COMBAT_REACTION_TIMEOUT_MS` — reaction window, default `4000`, allowed `1000–15000`;
- `COMBAT_TUTORIAL_TURN_TIMEOUT_MS` — future tutorial accessibility window, default `15000`.

A timed-out player does **not** attack automatically. The default player fallback is `GUARD`.
Mobs retain `BASIC_ATTACK` as their fallback, so existing PvE automation remains deterministic.
An actor may later expose a configured `SKIP` fallback without changing the engine.

Every resolution records `decisionTimeMs` and `timedOut`. The server report
`npm run analytics -- turn-timing` exposes median and P95 decision time, timeout rate and
outcome-changing reactions.

## Formation

Each team owns unique slots `0–9`:

- slots `0–4`: `FRONT`;
- slots `5–9`: `BACK`.

When callers do not provide slots, the engine deterministically fills a balanced front/back layout.
Explicit duplicate or out-of-range slots are rejected.

Ordinary single-target attacks and `ENEMY` skills can target only living front-row enemies while a
front row exists. Back-row access becomes legal after the front row is defeated or through a skill
with an explicit targeting rule. The production targeting vocabulary is:

- `SELF`;
- `ALLY`;
- `ENEMY`;
- `ALL_ALLIES`;
- `ALL_ENEMIES`;
- `FRONT_ROW`;
- `BACK_ROW`;
- `ADJACENT`.

Legacy `AREA` remains an alias for `ALL_ENEMIES`. `CombatEngine.legalTargetIds` is the shared source
used to build snapshot legal actions; clients and AI must not recreate target rules.

## Tactical actions

- `GUARD` — reduces incoming damage until the actor's next turn and is the default player timeout.
- `INTERCEPT` — protects a living ally; the next incoming hit is redirected to the protector and
  receives an additional intercept reduction.
- `INTERRUPT` — reaction-only; cancels an interruptible telegraph and applies `STAGGER`.
- `CLEANSE` — removes harmful statuses in deterministic priority order, hard control first.
- `SWAP` — exchanges two allied formation slots.
- `SUPPORT_ENERGY` — transfers up to 20 energy without creating energy.
- `SKIP` — explicitly holds position without a free attack.

All commands use the existing `combat:act` or `pve:act` route. They carry `requestId` as operation
ID and may carry `expectedTurn`.

## Telegraphs and reactions

Telegraph data lives in `CombatRuntime`, not in a process-local auxiliary service. A telegraph
contains the actor, skill, public intent, selected targets, close time, counter types and the set of
actors that already reacted. One actor may react at most once per telegraph.

The first version telegraphs heavy production skills including Meteor, Elemental Cataclysm,
Unbreakable Assault and Rain of Arrows. Legal counters are returned in `snapshot.legalActions`.
The client displays the server intent and deadline; it does not infer whether an interrupt or
intercept is possible.

## Synergies

The tactical skill ruleset is versioned and compiled into the content manifest.

1. Predator's Mark applies the ordinary vulnerability and `EXPOSED`.
2. Warrior Execution consumes `EXPOSED` for an additional coefficient.
3. Perfect Hunt consumes the longer vulnerability instead of allowing permanent passive stacking.
4. Rooted targets take additional incoming damage, creating setup for team finishers.
5. Guard/intercept/interrupt materially change telegraphed outcomes.
6. Battle Cry targets all living allies, providing direct team support.

## PvP control diminishing returns

Repeated hard control in PvP uses one shared path:

- first application: 100% duration;
- second: 50%;
- third: 25%;
- fourth: resisted.

The chain resets after eight combat turns without another hard-control application. PvE uses the
definition duration unchanged. Snapshot `controlResistanceBasisPoints` makes the current resistance
visible to the UI.

## Idempotency and stale commands

`requestId`/`operationId` is stored with a command fingerprint and the resolved snapshot.

- an identical replay returns the original result without a second effect;
- reuse with another payload is rejected as a collision;
- `expectedTurn` different from the server turn is rejected;
- the receipt cache is bounded to 128 operations per combat.

Action history is also bounded and monotonic through `sequence`. A reconnect uses `lastSequence` to
avoid replaying an animation twice.

## Content and rollback

`compileCurrentTacticalContent` applies the tactical skill rules before hashing the manifest and
uses content version `2026.08.01.3`. Target scopes, effect changes and telegraph metadata therefore
participate in content diff, deploy idempotency and rollback.

## Validation matrix

Unit coverage includes:

- 1/3/5/10 per side and uneven 1v10;
- unique formation slots and front/back legality;
- ally/row target generation;
- defensive timeout;
- intercept redirection;
- telegraph snapshot, reconnect and interrupt;
- cleanse;
- PvP control diminishing returns;
- operation replay, collision and stale turn.

The required startup chain remains `prisma generate → prisma migrate deploy → prisma seed` through
`prisma:prepare`.
