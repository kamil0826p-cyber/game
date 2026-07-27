# Tiled Map Integration Self-Review

## Scope reviewed

- Frontend Tiled parsing and rendering.
- External `.tsj`, atlas, and collection-of-images resolution.
- Backend collision, portal, and metadata compilation.
- Prisma seed discovery and validation.
- Greenfields and Crystal Cave example content.

## Findings fixed

1. **The first version sliced a finished illustration into arbitrary tiles.** It was technically addressable by GID but unsuitable for normal map editing.
2. **The second version still kept every tile in one atlas file.** Both example tilesets now use Tiled Collection of Images with one independent SVG file per tile ID.
3. **Asset loading failures were hidden.** The loader previously caught every tileset/image error and the renderer silently drew a primitive checkerboard. Tile errors now propagate with a descriptive message.
4. **Unknown GIDs were silently skipped.** The renderer now checks every non-zero visual GID before drawing and reports GIDs without graphics.
5. **Tile purpose was opaque.** Every tile has a descriptive filename and a `role` custom property.
6. **Layer and gameplay metadata remain separate.** Collision, portals, spawns, and entities are still authored independently from visual graphics.

## Final tileset structure

- `greenfields.tsj` has `columns: 0`, no top-level `image`, and 24 tile entries with 24 separate image paths.
- `crystal-cave.tsj` has `columns: 0`, no top-level `image`, and 16 tile entries with 16 separate image paths.
- The old `greenfields.svg` and `crystal-cave.svg` atlas files are removed.
- Object and decoration graphics use transparent backgrounds where they are intended to be layered over terrain.
- Map GIDs remain stable, so the existing authored layer placement continues to select the same semantic tiles.

## Remaining constraints

- Infinite/chunked maps are not supported.
- Base64 and compressed tile-layer data are not supported.
- Image layers, tile animations, wang sets, and object templates are not rendered.
- Live hot reload of seeded map data is not implemented.

## Validation performed

- Checked both TSJ files contain no atlas image and use Collection of Images metadata.
- Checked all declared tile IDs are unique and contiguous.
- Checked all 40 referenced SVG paths exist on the branch.
- Checked every individual SVG is a 32x32 standalone graphic.
- Reviewed URL resolution relative to the external TSJ file.
- Reviewed renderer coverage checks and removal of the silent primitive fallback.
- Kept map JSON, portal coordinates, spawn coordinates, collision data, and layer GIDs unchanged.
