# Tiled map system self-review

## Replaced architecture

The previous renderer reduced a map to one ground array and a synthetic obstacle texture. The replacement consumes native Tiled groups, ordered tile layers and multiple embedded tilesets. Browser route previews and backend movement compile collision from the same map semantics.

## Reviewed invariants

- Greenfields and Crystal Cave are independently authored maps with reciprocal portals.
- Browser map copies are byte-identical to authoritative seed files.
- Players and NPCs share one Y-sorted entity plane.
- Map layers are split below and above that plane.
- Tree trunks use collision rectangles; canopy tiles remain walkable.
- Cave collision combines a tile mask with object hitboxes.
- Invalid maps fail instead of falling back to permissive movement.

## Intentional limits

- Tilesets must be embedded.
- Collision objects are unrotated rectangles.
- Image layers, tile animation, blend modes and parallax are not rendered yet.
- The committed SVG tilesheets are editable source assets and can be replaced without changing map semantics when tile IDs remain stable.

## Validation

CI installs both workspaces and runs `npm run check:all`. Tests cover real maps, dimensions, tileset counts, reciprocal portals, spawn tiles, browser/backend copy parity and the canopy-versus-trunk case.
