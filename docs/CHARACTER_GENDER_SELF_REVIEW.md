# Character gender - self review

## Scope

- `MALE` and `FEMALE` remain persisted, server-authoritative character properties.
- Existing rows continue to use the database default and older clients may omit gender, which resolves to `MALE`.
- Gender changes presentation only. Class templates, combat statistics, loot, movement, progression, and unlock rules are unchanged.

## Outfit rendering

- Every one of the 33 outfit keys has a dedicated male sheet and a dedicated female sheet.
- The resolver uses both outfit key and gender and never substitutes another outfit.
- Texture caches include gender, preventing a previously loaded male texture from being reused for a female character with the same outfit key.
- Character creator, roster, and Pixi world rendering use the same gender-specific resolver.
- Callers that omit gender remain compatible and render as `MALE`.

## Asset properties

- 66 unique SVG sheets with embedded high-resolution raster artwork: 33 male and 33 female.
- Each sheet is `384x576`, containing 16 frames of `96x144`.
- World scale is `0.5`, so the visible size remains `48x72` logical pixels.
- See `CHARACTER_SPRITE_RESOLUTION_AUDIT.md` for the resolution analysis and generation details.

## Verification

```bash
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build
npm run typecheck
npm test
```
