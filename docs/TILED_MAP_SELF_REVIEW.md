# Tiled Map Integration Self-Review

## Scope reviewed

- Frontend Tiled parsing and rendering.
- External `.tsj` and tileset image resolution.
- Backend collision, portal, and metadata compilation.
- Prisma seed discovery and validation.
- Canonical map ownership and removed duplicates.
- Greenfields and Crystal Cave example content.

## Findings fixed during review

1. **Collision layers could accidentally render.** The renderer excludes collision-marked layers even when an editor makes them visible.
2. **Layer dimensions were assumed to match the map.** Finite smaller layers with `x`/`y` offsets are accepted and compiled correctly.
3. **Nested Tiled groups were ignored.** Parsing, collision compilation, and rendering walk group layers recursively and preserve inherited visibility, opacity, and offsets.
4. **Only legacy object `type` was recognized.** Portal extraction accepts modern Tiled `class` and legacy `type`.
5. **Map metadata was duplicated in TypeScript.** Map key, name, zone, spawn, and default-map selection come from Tiled custom properties.
6. **Backend and frontend map copies could drift.** Prisma seed imports the canonical files from `frontend/public/maps`.
7. **The seeded merchant position was hardcoded.** The seed reads the `quartermaster` point object from the default map.
8. **The first example tilesets were not real reusable tilesets.** They embedded one pre-rendered illustration and sliced it into arbitrary fragments. Both examples now use 8x4 semantic atlases with 32 independent 32x32 tiles.
9. **The maps did not demonstrate normal Tiled authoring.** Greenfields is now painted from separate ground, road, river/bridge, building/nature, collision, portal, and entity layers. Crystal Cave uses separate floor, wall, prop, collision, and portal layers.
10. **Tile purpose was opaque.** Every TSJ tile now has a `role` custom property such as `grass`, `bridge`, `tree`, `wall-top`, `crystal-cluster`, or `pit`.

## Tileset usage verified

- Greenfields uses distinct GIDs for grass variants, horizontal and vertical roads, a crossing, water, bridge, trees, bushes, rocks, buildings, cave entrance, flowers, lamp, crate, well, bench, and reeds.
- Crystal Cave uses distinct GIDs for floor variants, side and top walls, exit, stalagmites, crystals, rocks, bridge, mushroom, spikes, pit, chest, and crystal spires.
- All layer GIDs are within the declared 32-tile range.
- Collision remains data-only and does not depend on the visual tile role.

## Remaining constraints

- Infinite/chunked maps are not supported.
- Base64 and compressed tile-layer data are not supported; save JSON layers as integer arrays.
- Image layers, tile animations, wang sets, and object templates are not rendered.
- Tile flip combinations are handled in the Pixi renderer, but screenshot regression tests would still be valuable.
- Map data is imported during seeding; live hot reload is not implemented.

## Validation performed

- Parsed both map JSON files and both external TSJ files locally.
- Checked dimensions, layer lengths, GID ranges, map metadata, spawn coordinates, portal coordinates, reciprocal destinations, and collision sources.
- Verified Greenfields uses 18 visual tile GIDs across four visible tile layers.
- Verified Crystal Cave uses 14 visual tile GIDs across three visible tile layers.
- Reviewed the branch diff against the merged `main`; only the two maps, two TSJ files, two SVG atlases, and this review document are changed.
