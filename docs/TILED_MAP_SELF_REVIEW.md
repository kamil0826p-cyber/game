# Tiled Map Integration Self-Review

## Scope reviewed

- Frontend Tiled parsing and rendering.
- External `.tsj` and tileset image resolution.
- Backend collision, portal, and metadata compilation.
- Prisma seed discovery and validation.
- Canonical map ownership and removed duplicates.
- New Greenfields and Crystal Cave examples.

## Findings fixed during review

1. **Collision layers could accidentally render.** The renderer now excludes collision-marked layers even when an editor makes them visible.
2. **Layer dimensions were assumed to match the map.** Finite smaller layers with `x`/`y` offsets are now accepted and compiled correctly.
3. **Nested Tiled groups were ignored.** Parsing, collision compilation, and rendering now walk group layers recursively and preserve inherited visibility, opacity, and offsets.
4. **Only legacy object `type` was recognized.** Portal extraction now accepts modern Tiled `class` and legacy `type`.
5. **Map metadata was duplicated in TypeScript.** Map key, name, zone, spawn, and default-map selection now come from Tiled custom properties.
6. **Backend and frontend map copies could drift.** Prisma seed now imports the canonical files from `frontend/public/maps`; `prisma/maps` is removed.
7. **The asset manifest duplicated Tiled tileset metadata.** Tileset image slicing now comes from map and `.tsj` files; the manifest contains only outfit assets.
8. **The seeded merchant position was still hardcoded.** The seed now reads the `quartermaster` point object from the default Tiled map.
9. **Container seeding would lose the canonical maps.** The Docker build and production stages now copy `frontend/public/maps`.

## Remaining constraints

- Infinite/chunked maps are not supported.
- Base64 and compressed tile-layer data are not supported; save JSON layers as integer arrays.
- Image layers, tile animations, wang sets, and object templates are not rendered.
- Tile flip combinations are handled in the Pixi renderer, but a screenshot regression suite would still be valuable before relying heavily on rotated tiles.
- Map data is imported during seeding; live hot-reload of edited maps is not implemented.

## Validation performed

- Parsed both generated map JSON files and both external tilesets with a local validation script.
- Checked map metadata, spawn walkability, portal source/target walkability, reciprocal destinations, layer data lengths, image dimensions, and GID ranges.
- Generated and inspected the committed tileset SVGs locally.
- Ran syntax checks for the asset generator and reviewed the changed TypeScript modules for contract consistency.
- Updated frontend map compiler and pathfinding fixtures for the new map contract; full package test execution still depends on installing the repository dependencies.
