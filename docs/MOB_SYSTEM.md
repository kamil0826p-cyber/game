# Mob and PVE system

## Ranks

The shared runtime types define five ordered ranks: **Pomiot**, **Kat**, **Arcykat**, **Żniwiarz** and **Przedwieczny**. Rank multipliers live in one typed table so combat and future balancing code can use the same rules.

The initial content is inserted by `prisma/seed.ts`: seven level-2 Królik Pomiot rows in Greenfields and seven level-7 Skorpion Kat rows in Crystal Cave. The seed validates collision, portals, the player spawn and the merchant tile, then moves an invalid requested mob position to the nearest unique walkable tile.

`MobDefinition` rows are the only runtime source of truth. `MobCoordinatorService` never creates or updates definitions; on startup it only reads the database, validates the stored records and creates in-memory runtime state for combat and respawn.

## Combat

Clicking an adjacent mob starts an immediate server-authoritative PVE combat through the existing `CombatEngine`. Players retain their learned skills, cooldowns and energy. Mobs currently use only the basic attack and resolve their turn after a short AI delay. The same actor lock used for combat prevents two players from claiming one mob.

## Rewards and progression

A defeated mob grants its configured experience and independently rolls every loot-table entry stored in the database. Experience overflow can advance multiple levels. Every gained level adds max HP, max energy and base combat stats.

Loot is stacked first and then placed in free inventory slots. When the inventory cannot hold the entire drop, the granted and skipped quantities are reported separately instead of silently deleting existing items.

## Respawn lifecycle

Every database mob row is a separate runtime instance with the states `ALIVE`, `IN_COMBAT` and `RESPAWNING`.

1. A claimed mob cannot be attacked by another player.
2. On defeat it is removed from the map and receives its own `respawnsAt` timestamp.
3. A per-instance timer restores it after the row's `respawnMs` value.
4. If a player stands on its spawn tile, the timer retries one second later.
5. Spawn and despawn events are broadcast only to players on that map.

A server restart rebuilds runtime instances from the existing `MobDefinition` rows. Running `npm run prisma:seed` intentionally synchronizes the initial development data, just as it does for maps, NPCs and skills.
