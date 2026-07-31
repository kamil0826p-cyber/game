# Character gender - self review

## Scope

- Added `MALE` and `FEMALE` as a persisted, server-authoritative character property.
- Existing rows become `MALE` through a non-null database default in the migration.
- Character creation sends name, class, gender, and starting outfit in one command, so no transient wrong appearance is stored.
- Roster, selected character, public world state, previews, and Pixi character rendering carry gender.
- Gender is visual only. It does not affect class templates, combat stats, loot, movement, or progression.

## Assets

Every one of the 33 outfit keys has independent paths under:

- `frontend/public/assets/sprites/male/`
- `frontend/public/assets/sprites/female/`

Both paths currently point to copies of the existing art. Legacy root files remain fallback candidates, which makes deployment tolerant of stale browser/CDN caches. World and lobby female art can be replaced per outfit without changing keys or resolver code. The combat-specific limitation is documented below.

## Security and compatibility

- The socket schema accepts only `MALE` or `FEMALE`.
- Older creation clients that omit gender default to `MALE`.
- Outfit unlock validation remains server-side.
- Existing character IDs, outfit keys, and class values are unchanged.
- Missing gender in an old cached payload is rendered as `MALE` on the client.

## Review findings fixed

- The old creator selected an outfit and then performed a second update. The new appearance-aware creation event persists gender and outfit atomically.
- The roster displayed a hard-coded total of 10 outfits despite each class having 11. It now uses the catalog length.

## Tests added or extended

- Character service: selected gender and legacy male default.
- Socket schema: default, accepted, and rejected gender values.
- Frontend catalog: all 33 outfits resolve to separate male/female paths and retain legacy fallback.

## Known limitation

Combat participant payloads still identify appearance by outfit key only. This is visually neutral while male and female sprite sheets are identical. Before replacing female sheets with different artwork, gender should also be added to the combat participant contract and passed to `OutfitPreview` in the combat arena.
