# Canonical character stats and progression v2

## Ownership

`calculateCharacterStats` is the single formula for permanent character attributes. Its snapshot separates:

- `base`: the level-one class identity;
- `automaticProgression`: deterministic class-specific growth from completed levels;
- `milestoneChoices`: player decisions earned every five levels;
- `legacyAdjustment`: the migration bridge that preserves pre-v2 effective stats;
- `equipment`: the sum of currently equipped item snapshots;
- `temporary`: explicit encounter/status modifiers supplied by a caller;
- `derived`: combat power, physical mitigation and effective health after diminishing returns.

The effective displayed attributes are the exact sum of the six source vectors. The world stores that effective value as a cache. It is repaired from the source data before a session is created, after a level-up, and after every equip/unequip operation.

Persistence owns position, current HP/energy, level/experience and combat state. It deliberately does not overwrite max HP, max energy, strength, agility, intelligence or armor from a detached session snapshot.

## Growth profiles

All curves are cumulative integer functions of completed levels, so reconnecting or recalculating cannot add a bonus twice.

- Warrior: strongest HP, strength and armor growth.
- Mage: strongest energy and intelligence growth.
- Archer: strongest agility and balanced energy growth.

A progression point is earned at levels 5, 10, 15 and so on, up to level 100. A point can be placed in:

- Endurance: HP and armor;
- Precision: strength and agility;
- Ritual knowledge: energy and intelligence;
- Mobility: energy and agility;
- Control: HP, intelligence and armor.

Each node has eight ranks. A character can reset the whole choice sequence. The first v2 reset is free; subsequent resets cost silver using `500 + level * 50 + spentPoints * 100`. The debit and progression audit are committed in one transaction, and request IDs are idempotent and collision-checked.

## Diminishing returns

Source totals remain visible and auditable. Combat consumes the derived values:

- strength, agility and intelligence: full value through 80, then 50% value, hard cap 140;
- armor: full value through 60, then 40% value, hard cap 100;
- physical mitigation uses the capped armor value and is displayed in the character panel;
- initiative and skill/basic-attack scaling use the same capped primary-stat helper as the UI and simulator.

This prevents late-level equipment from producing runaway damage or mitigation while preserving useful secondary-stat choices.

## Equipment and level-up safety

Equipping and unequipping never mutate a hidden base value. The transaction changes the equipped slot and recomputes all effective stats from the current sources. Removing an item therefore removes exactly its own vector, including after level-ups or reconnects.

Level-up updates only level and experience, then invokes the same calculator with an `ADD_MAX_DELTA` resource policy. Newly gained maximum HP/energy is added to current resources; equipment and legacy adjustments are not reapplied incrementally.

## Migration

Migration `20260801061000_canonical_stat_progression` performs these operations transactionally:

1. adds versioned progression source columns;
2. copies every pre-v2 effective stat row to `CharacterProgressionMigrationBackup`;
3. calculates equipped-item bonuses from immutable content snapshots where available;
4. stores `legacyStatAdjustment = oldEffective - base - growth - equipment`;
5. writes a `MIGRATION` row to `CharacterProgressionAudit`.

The result is deterministic and preserves every migrated character's exact effective attributes at rollout time, not merely an approximate class percentile.

Operational commands:

```bash
npm run progression -- status
npm run progression -- migrate --dry-run
npm run progression -- migrate
npm run progression -- rollback --dry-run
npm run progression -- rollback
```

Rollback restores pre-v2 effective attributes and state versions from the backup, clears v2 choices/adjustments and writes `ROLLBACK` audit rows. Application rollback and data rollback must be deployed together. Backups are retained for forensic comparison and are deleted automatically only when their character is deleted.

## Simulation

The progression simulator uses `calculateCharacterStats` and the production `CombatEngine`; it has no Prisma, reward or world-state dependency.

```bash
npm run progression:simulate
npm run progression:simulate -- --runs=1000 --levels=1,10,25,50,75,100 --team-sizes=1,3,5,10 --output=artifacts/progression-ttk.json
```

It runs deterministic seeded fights across representative class/build pairs, level thresholds and group sizes 1–10. The report includes wins, timeouts and min/average/max action counts. A non-controlled profile exits with code 2 so balance changes can be gated in CI once runners execute normally.

## UI and API

The character panel requests an authoritative progression snapshot and shows every source next to the effective total, derived combat values, caps, points, node ranks and reset cost. It does not reproduce the formula in the browser.

Socket commands:

- `progression:get`
- `progression:choose`
- `progression:respec`

Mutations require an active in-world session, quiesce movement, persist pending session state, execute under a per-character advisory transaction lock and refresh the authoritative inventory/current-resource snapshot afterwards.
