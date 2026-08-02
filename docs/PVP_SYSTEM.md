# Purposeful PvP foundation

This document describes the server-authoritative PvP layer introduced for issue #214. It extends the existing combat flow without forking or replacing `CombatEngine`.

## Architecture

`PvpCombatIntegrationService` is the only bridge between player combat requests and PvP policy. It performs policy checks before combat starts, records the exact roster returned by the production combat service, observes authoritative combat snapshots, accumulates the deterministic event log, and settles the result once.

The production `CombatService` and `CombatEngine` remain responsible for teams, formations, targeting, reactions, damage, turns, disconnect fallback, and the final winner. The PvP layer is responsible for legality, protection windows, notoriety, rating, rewards, bounty escrow, objective contribution, replay retention, reports, risk signals, and analytics outbox events.

## Zone rules

| Zone | Default behavior | Legal exceptions | Consequence |
| --- | --- | --- | --- |
| `SAFE` | Unsolicited PvP is rejected | A consented activity may opt in | No notoriety for legal activity |
| `OUTLAW` | Standard duel requires consent | Accepted bounty contracts can authorize a hunter; open-world aggression is possible by explicit PvP action | Unlawful aggression adds notoriety |
| `PVP` | Combat may start immediately | Newcomer, spawn, reconnect, defeat, combat, repeat-pair, and extreme power-gap protections still apply | Legal aggression; no notoriety |

A valid combat that has already started is owned by `CombatService`; normal portal movement cannot silently erase it because movement remains blocked by the existing combat occupancy rules.

## Anti-griefing

The policy layer checks:

- newcomer protection through level 10 unless the defender explicitly opts in;
- spawn and reconnect protection for 20 seconds;
- defeat protection for 90 seconds;
- a 15-second general combat cooldown;
- a 120-second cooldown for the same opponent pair;
- a maximum unnormalized level gap outside a legal bounty;
- diminishing rewards for repeated wins against the same pair in a 30-minute window: `100%`, `35%`, then `0%`.

Protection uses server time. Risk signals are review inputs only; they never automatically ban a player.

## Notoriety and redemption

Unlawful `OUTLAW` aggression adds versioned notoriety. The value decays by one point every 30 minutes of server time. The public overview exposes the current tier and consequences:

- `AGGRESSOR`: 5% guarded-service surcharge;
- `OUTLAW`: 15% surcharge, guarded NPC services unavailable, hunter visibility;
- `HUNTED`: 25% surcharge, guarded NPC services and guarded portals unavailable, hunter visibility.

Players can redeem up to 20 points per operation using ordinary silver at 250 silver per point. The debit, currency ledger, notoriety update, and outbox event are performed in one transaction and are idempotent by operation ID.

## Bounties

Player-created bounties enforce:

- 100–100,000 silver escrow;
- a 5% fee with a minimum of 10 silver;
- a duration from one hour to seven days;
- five creations per rolling 24 hours;
- no self-target or same-account target;
- up to three active accepted contracts per hunter;
- idempotent creation by `(creatorCharacterId, operationId)`;
- atomic create, cancel, expire, refund, accept, and claim transitions.

The board returns only a coarse region hint. It never exposes exact coordinates. Claim eligibility requires the accepted hunter, the contracted target on the losing side, a legal recorded PvP combat, and eligible contribution. Eligible winners split the escrow deterministically without creating or losing silver.

## Modes and matchmaking

The rules catalog supports 1, 2, 3, 5, and 10 players per side:

- duel 1v1;
- skirmish 2v2;
- skirmish 3v3;
- warparty 5v5;
- warhost 10v10;
- control ritual 5v5;
- relic hold 10v10.

Every definition has a version, legal team size, objective, score/round/time limits, tie-breaker, disconnect policy, rating pool, reward profile, normalization flag, and shared consumable allow-list.

Matchmaking compares rating and uncertainty, team size, party size, premade status, explicit premade-mismatch opt-in, and queue time. The allowed rating gap expands with queue time but stops at a hard cap. A solo or partial party is never silently matched against a full premade unless both sides opted in.

## Ranked normalization

Ranked modes use a controlled level-50 budget for base PvP coefficients. The preview returns original and normalized values plus retained offense/defense ratios. This preserves build identity while limiting raw level and wealth advantage. The combat skill catalog and skill logic remain shared with PvE and open-world combat.

Premium effects are not part of the profile. Consumables are restricted to the common mode allow-list.

## Objectives and contribution

Objective modes use a deterministic state machine for ritual control, relic capture/hold, elimination rounds, and terminal time/tie rules. Objective systems can record idempotent server-side contribution events in `PvpObjectiveContribution`.

Settlement combines those points with combat events. Damage, healing, shielding, control, objective points, active time, late join, and disconnect state all affect eligibility. AFK, very late, or zero-contribution participants do not receive full rewards.

## Rating, season, and rewards

Rating is separated by mode/size pool. Updates include placement matches and uncertainty and are exactly once because `PvpCombatSettlement.combatId` is the settlement idempotency key. Seasonal reset is soft, not zero.

The active preseason rewards only titles, heraldry, chronicle entries, renown, cosmetic tokens, and controlled non-power progression. Season validation rejects reward keys that imply permanent stat, damage, level, or power gains.

Reward rows are unique per `(combatId, characterId)`. The settlement outbox event and ledger writes occur in the same database transaction.

## Replay, reporting, and retention

The integration layer accumulates authoritative combat events by sequence and stores a stable replay envelope with a deterministic checksum. Private commands are not included before resolution. A participant can retrieve their own replay for 90 days.

A report requires a combat ID in which the reporter participated. Reports create reviewable risk signals and outbox events; no automatic punishment is applied.

## Operations

Apply the migration with the existing `prisma:migrate:deploy` flow. PvP tables are intentionally accessed through raw parameterized Prisma SQL so the existing `Character`, `Map`, currency ledger, and combat runtime do not need a second domain model or duplicated state.
