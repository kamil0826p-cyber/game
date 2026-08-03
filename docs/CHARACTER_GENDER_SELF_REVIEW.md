# Character gender - self review

## Scope

- Added `MALE` and `FEMALE` as a persisted, server-authoritative character property.
- Existing rows become `MALE` through a non-null database default in the migration.
- Character creation sends name, class, gender, and starting outfit in one command, so no transient wrong appearance is stored.
- Roster, selected character, public world state, previews, and Pixi character rendering carry gender.
- Gender is visual only. It does not affect class templates, combat stats, loot, movement, or progression.

## Assets

Every one of the 33 outfit keys has an independent PNG under both:

- `frontend/public/assets/sprites/male/`
- `frontend/public/assets/sprites/female/`

Asset resolution is exact: a selected outfit key loads only its matching gender-specific PNG. The client does not recolor a base sprite, load a legacy root asset, or substitute another outfit from the same class. A missing or invalid sheet is reported as an asset error instead of silently changing the character appearance.

## Security and compatibility

- The socket schema accepts only `MALE` or `FEMALE`.
- Older creation clients that omit gender default to `MALE`.
- Outfit unlock validation remains server-side.
- Existing character IDs, outfit keys, and class values are unchanged.
- Missing gender in an old cached payload is rendered as `MALE` on the client.

## Review findings fixed

- The old creator selected an outfit and then performed a second update. The new appearance-aware creation event persists gender and outfit atomically.
- The roster displayed a hard-coded total of 10 outfits despite each class having 11. It now uses the catalog length.
- Legacy asset fallback logic could display a different class outfit when the selected PNG was missing. All preview and world rendering paths now resolve one exact PNG.
- The asset generator previously mapped multiple outfit keys to a shared base image. It now validates 66 independent gender-specific files and keeps the 1/10/20/.../100 unlock schedule.

## Tests added or extended

- Character service: selected gender and legacy male default.
- Socket schema: default, accepted, and rejected gender values.
- Frontend catalog: all 33 outfits resolve to separate male/female paths.
- Frontend asset tests: no legacy, SVG, class-level, or copied-outfit fallback path is exposed.

## Known limitation

Combat participant payloads still identify appearance by outfit key only. Before male and female combat artwork diverges, gender should also be added to the combat participant contract and passed to `OutfitPreview` in the combat arena.
