# Mob and PvE encounter system

## Ranks and world instances

The shared runtime types define five ordered ranks: **Pomiot**, **Kat**, **Arcykat**, **Żniwiarz** and **Przedwieczny**. Rank multipliers live in one typed table so combat and balancing code use the same rules.

The initial content is inserted by `prisma/seed.ts`: seven level-2 Królik Pomiot rows in Greenfields and seven level-7 Skorpion Kat rows in Crystal Cave. The seed validates collision, portals, the player spawn and the merchant tile, then moves an invalid requested mob position to the nearest unique walkable tile.

`MobDefinition` rows remain the runtime source of truth for persistent world instances, stats, loot, claim state and respawn. Clicking one world mob claims only that row. Additional enemies created by its encounter exist only inside combat and do not create independent world respawns.

## Versioned encounter definitions

A claimed mob rank selects a typed encounter definition identified by stable `key + version`. Definitions contain:

- allowed and recommended party size;
- actor templates, roles, front/back formation and skills;
- deterministic AI policies and target priorities;
- scaling tiers for 1, 3, 5 and 10 players;
- three readable phases, summons and arena modifiers;
- telegraphs and declared counters;
- victory/defeat and contribution-based reward rules.

The catalog is validated at startup and in unit tests. Invalid skill/actor references, unreachable phases, unsafe strong actions, incomplete scaling tiers and any possible roster above ten enemies fail validation.

Scaling changes mechanics in addition to HP and power. Larger parties introduce guards, support actors, back-line pressure, wider telegraphs, more break capacity and bounded summon waves.

## Shared authoritative combat

PvP and PvE still use one `CombatEngine`. Encounter AI reads `CombatEngine.legalActions()` and submits the selected command through `CombatEngine.act()`, so target restrictions, formation, energy, cooldowns, reactions, statuses and idempotent operation checks cannot be bypassed.

AI RNG is deterministic for a fixed encounter/combat/turn/actor/phase seed. A bounded server trace stores the selected role, policy and reason. High-impact skills such as Meteor use the existing telegraph and reaction window; players and AI can respond with normal tactical actions.

Phase summons are inserted as normal actors into the existing combat team and turn queue. Runtime checks preserve unique actor IDs, free formation slots and the ten-actor team limit.

## Contributions and rewards

Reward eligibility measures damage, healing, shields/protection, cleanses, interrupts and mechanic actions. Withdrawn, late, inactive and zero-contribution characters can be excluded with a clear reason; support is not evaluated only by damage.

Encounter XP is scaled and then split among eligible players. Loot stays personal. The complete settlement is recorded transactionally in the existing currency ledger under a unique `encounter:<combatId>` operation. Replaying completion returns that stored settlement instead of granting XP, inventory items or quest progress again.

## Respawn lifecycle

Every database mob row is a separate runtime instance with the states `ALIVE`, `IN_COMBAT` and `RESPAWNING`.

1. A claimed world mob cannot be attacked by another player.
2. Player defeat, cancellation or server shutdown releases the claim without rewards.
3. On victory the root mob is removed from the map and receives its own `respawnsAt` timestamp.
4. A per-instance timer restores it after the row's `respawnMs` value.
5. If a player stands on its spawn tile, the timer retries one second later.
6. Spawn and despawn events are broadcast only to players on that map.

A server restart rebuilds runtime instances from the existing `MobDefinition` rows. Durable recovery of a half-finished in-memory combat, product telemetry and the production balance simulator remain part of deferred issue #204 rather than this encounter implementation.
