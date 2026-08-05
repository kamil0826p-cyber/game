# Character sprite resolution audit

## Audit result

The previous character set was too small and did not contain the advertised variety:

- every sheet was `128x192`, split into 16 frames of `32x48`;
- the Pixi character sprite used scale `1.5`, so the visible world footprint was `48x72` logical pixels;
- the renderer caps device resolution at `2`;
- 66 files contained only 6 unique binary images;
- every male/female pair was pixel-identical;
- the runtime resolver always loaded the legacy `male` directory.

The old sheets therefore supplied only 32x48 source detail and were enlarged in the world. Most level outfits and all gender variants were duplicates.

## Resolution decision

The replacement uses frames of **96x144** in sheets of **384x576**, a 3x increase on each source axis. Pixi scale changes from `1.5` to `0.5`, leaving the visible character footprint unchanged at **48x72**.

Why 3x is the correct target:

| Candidate | Frame | Pixi scale | DPR 1 mapping | DPR 2 mapping | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Existing | 32x48 | 1.5 | 1.5x upsample | 3x upsample | insufficient detail |
| 2x source | 64x96 | 0.75 | non-integer downsample | 1.5x upsample | still undersupplied on Retina |
| **3x source** | **96x144** | **0.5** | exact 2:1 downsample | exact 1:1 mapping | selected |
| 4x source | 128x192 | 0.375 | more source than display needs | more source than DPR cap needs | no visible benefit for the current renderer |

The replacement sheets use vector-authored detail inside a `384x576` canvas, with each animation cell occupying `96x144`. The larger working grid gives the artist room for facial features, layered armor, cloth folds, weapon highlights, heraldry, and high-tier effects while the `0.5` world scale preserves the previous footprint.

## Replacement set

- 33 unique male sheets;
- 33 unique female sheets;
- 11 outfits each for mage, warrior, and archer;
- 4 directions and 4 walk frames per sheet;
- distinct silhouettes, hair, armor/robe construction, weapons, palettes, heraldry, and high-tier effects;
- all old PNG files removed and replaced by self-contained SVG sprite sheets, so no stale sprite file remains under either gender directory.

The committed sheets are self-contained SVG image files generated deterministically by the existing asset script. Each sheet contains 16 vector animation cells, so the source remains sharp at the renderer's DPR cap without introducing a new binary-art pipeline.

## Runtime changes

- gender now participates in the sprite URL and texture cache key;
- world, creator, and roster previews pass the character gender;
- callers without gender retain the compatible `MALE` fallback;
- frame slicing uses `96x144` and validates `384x576` sheets;
- the world sprite scale is `0.5`, preserving the previous on-map size;
- asset version increased to `18` to invalidate cached legacy sheets.

## Regression coverage

Tests verify that:

- both directories contain exactly 33 SVG sprite files;
- all sheets are `384x576`;
- all 66 files have distinct SHA-256 hashes;
- every outfit has a distinct male and female drawing;
- every URL resolves to the requested gender without cross-outfit fallback.
