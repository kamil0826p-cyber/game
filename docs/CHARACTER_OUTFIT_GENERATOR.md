# Character outfit generator

The repository contains a deterministic dark-fantasy character generator for all 66 player outfit sheets.

## Run it

From the repository root:

```bash
npm run outfits:generate
```

Or directly from the frontend directory:

```bash
npm run outfits:generate
```

The command replaces every generated file under:

- `frontend/public/assets/sprites/male/`
- `frontend/public/assets/sprites/female/`

It also refreshes `frontend/public/assets/manifest.json` and increments the cache-busting asset version used by the client.

## Generator files

- `frontend/scripts/outfit-designs.mjs` contains the hand-authored visual specification for every outfit and gender.
- `frontend/scripts/outfit-designs/` splits the 33 designs into mage, warrior, and archer catalogs.
- `frontend/scripts/outfit-generator.mjs` renders the specifications into 4x4 SVG animation sheets.
- `frontend/scripts/outfit-generator-*.mjs` contain the reusable body, equipment, and utility renderers.
- `frontend/scripts/generate-outfits.mjs` is the one-command CLI entrypoint.
- `frontend/scripts/generate-assets.mjs` remains a compatibility entrypoint and calls the same generator.

## How uniqueness is enforced

Each of the 66 variants defines its own structural combination of:

- body profile;
- garment construction;
- headgear, mask, crown, or hairstyle;
- shoulder silhouette;
- primary weapon;
- off-hand item;
- back item, cape, trophy, wings, or banner;
- aura or environmental effect;
- chest emblem and detailing.

The generator fails when two variants share the same structural signature. The frontend asset test also verifies 66 unique component signatures and requires male/female variants of every outfit to differ in at least six construction fields. This prevents a shared base character with palette-only recolors from returning.

## Output format

Each generated file is a self-contained `384x576` SVG sprite sheet:

- 4 directions: south, west, east, north;
- 4 walking frames per direction;
- `96x144` source frame;
- 16 frames total;
- world scale `0.5`, preserving the existing `48x72` logical-pixel footprint.

The artwork is original dark fantasy designed for a classic browser RPG presentation. It does not require an external image service, API key, font, or binary graphics editor.
