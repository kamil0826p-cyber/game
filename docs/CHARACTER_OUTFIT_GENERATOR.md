# Character outfit generator

The repository contains a deterministic dark-fantasy SVG generator for 33 male and 33 female player outfit sheets.

## Run it

From the repository root:

```bash
npm run outfits:generate
```

The same command is available from `frontend`. It recreates the generated files under:

- `frontend/public/assets/sprites/male/`
- `frontend/public/assets/sprites/female/`

It also refreshes `frontend/public/assets/manifest.json`.

## Clean rendering rules

Generated sheets now use the `advanced-v5-clean` rendering pass. This pass corrects the visual failures caused by the previous primitive-count-driven overlay.

The generator enforces the following rules:

- a full helmet or hood suppresses all hair geometry;
- visible hair uses filled, bounded masses with only a few controlled highlights;
- no outfit emits head horns;
- trophy and antler-named back items are rendered as bounded emblems rather than antlers above the head;
- aura particles remain outside the body silhouette;
- the advanced overlay does not redraw the head, weapon, back item, or aura;
- material lines are clipped to the torso instead of crossing the face, helmet, body, or background;
- random body micro-strokes are disabled;
- generated SVG metadata records clean occlusion and zero horn geometry.

The asset cache version is `22`, so clients do not reuse the broken generated sheets.

## Relevant generator files

- `frontend/scripts/outfit-designs.mjs` joins the hand-authored visual specifications.
- `frontend/scripts/outfit-designs/` contains mage, warrior, and archer catalogs.
- `frontend/scripts/outfit-generator.mjs` builds the 4x4 sheets and rejects forbidden line-noise or horn metadata.
- `frontend/scripts/outfit-generator-safe-head.mjs` is the authoritative helmet, hood, face, and hair renderer.
- `frontend/scripts/outfit-generator-safe-parts.mjs` renders bounded auras and back items.
- `frontend/scripts/outfit-generator-overlay.mjs` adds clipped material construction, controlled arms, belts, and trim without duplicating the character.
- `frontend/scripts/outfit-generator-body.mjs` and `outfit-generator-equipment.mjs` render the remaining base body and equipment.
- `frontend/scripts/generate-outfits.mjs` is the command-line entry point.

## Uniqueness

Each variant still defines its own structural combination of body profile, garment, headgear, shoulders, weapon, off-hand item, back item, aura, and detail motif. The generator rejects duplicate structural signatures and duplicate generated SVG contents.

## Output format

Each generated file is a self-contained `384x576` SVG sprite sheet:

- four directions: south, west, east, and north;
- four walking frames per direction;
- `96x144` source frame;
- 16 frames total;
- world scale `0.5`, preserving the existing `48x72` in-game footprint.

The output is original dark-fantasy artwork intended for a classic browser RPG presentation.
