# Tiled map rebuild self-review

## Scope

- Replaced both existing maps with newly generated finite orthogonal Tiled maps.
- Replaced atlas-style tilesheets with image-collection tilesets using one SVG file per tile.
- Added 12 forest tiles and 12 cave tiles.
- Added explicit collision tile layers and reciprocal portals.
- Updated the Pixi asset loader to support both atlas and image-collection tilesets.

## Collision review

- Collision is authored in a hidden `Collision` tile layer with `collision=true` and `render=false`.
- Forest boundaries, trees, rocks and pond water are blocked; roads, bridge tiles, spawn, NPC and portal tiles remain walkable.
- Cave boundaries, abyss, crystals, rubble and rock formations are blocked; the spawn and portal corridor remain walkable.
- Both client and backend compile collision from the same canonical Tiled JSON, eliminating map-copy drift.

## Validation

- Verified every tile-layer array length equals `width * height`.
- Verified both spawn tiles are walkable.
- Verified both portal source and destination tiles are walkable and in bounds.
- Verified all used GIDs resolve to an image-collection tile.
- Added frontend regression tests for representative blocked and walkable coordinates.

## Remaining constraints

- Maps remain finite and orthogonal.
- Tile images are SVG placeholders and can be replaced independently without changing GIDs or map layout.
