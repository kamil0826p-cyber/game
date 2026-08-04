# Character gender - self review

## Scope

- `MALE` and `FEMALE` remain persisted, server-authoritative character properties.
- Existing rows continue to use the database default and all socket contracts remain compatible.
- Gender does not change class templates, combat statistics, loot, movement, progression, or outfit artwork.
- Character creation and roster views still display the stored gender, but they do not use it to select or recolor sprites.

## Outfit rendering

- The outfit key is now the only input used to resolve player artwork.
- Every one of the 33 outfit keys resolves directly to its own PNG under `frontend/public/assets/sprites/`.
- The character creator, character selection screen, HUD previews, combat previews, and Pixi world renderer share the same canonical resolver.
- Gender-specific sprite folders, palette variants, and cross-outfit fallback substitutions are not part of the runtime resolution path.
- A missing outfit image fails visibly instead of silently displaying artwork assigned to another level.

## Security and compatibility

- The socket schema still accepts only `MALE` or `FEMALE`.
- Older creation clients that omit gender continue to default to `MALE`.
- Outfit unlock validation remains server-side and unchanged.
- Existing character IDs, gender values, outfit keys, and class values are unchanged.
- No database migration is required because this change removes client-side presentation behavior only.

## Review findings fixed

- Removed gender from `OutfitPreview` and the Pixi outfit sheet loader.
- Removed gender from the world renderer's appearance cache key.
- Removed the fallback that substituted a different outfit image from the same class.
- Corrected stale frontend tests that expected ten outfits and multiple level-one variants.
- Added regression coverage proving that all 33 outfits use unique, exact image paths.

## Verification

Run the dependency-backed checks in a normal repository checkout:

```bash
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
```
