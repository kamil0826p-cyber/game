# Map Engine Audit

## Scope

Audit of Tiled map import, rendering, collision compilation, asset loading, portal extraction, and client/server parity.

## Findings fixed

1. **Tree-specific rendering and collision**
   - Runtime code matched `Tree Trunks`, `Tree Canopies`, GID `3`, and GID `4`.
   - Client and server separately expanded one hard-coded tree footprint.
   - Replaced with generic per-tile render properties and standard Tiled tile collision object groups.

2. **Textures coupled to a map key**
   - Tile textures came from map-specific `manifest.json` entries rather than the map tilesets.
   - The loader now reads embedded or external JSON tilesets, multiple tilesets, atlas margin/spacing, tile offsets, and per-tile images.
   - The manifest remains a legacy fallback.

3. **External tilesets accepted but not resolved**
   - A source-only tileset lost collision and texture metadata.
   - Browser loading and Prisma seed loading now resolve JSON `.tsj` files relative to the map. TSX/XML fails with an actionable error.

4. **Groups and offsets lost**
   - Only top-level layers worked correctly.
   - Group visibility, opacity, `renderBand`, tile offsets, and pixel offsets are now inherited consistently.

5. **Silent visual-layer normalization**
   - Mismatched layer data was cropped or padded.
   - Data length is now validated against the layer dimensions; offsets are preserved.

6. **Incomplete GID masking**
   - The previous mask left Tiled's fourth high-bit flag in the tile ID.
   - All four high flags are cleared before lookup. Orthogonal horizontal, vertical, and diagonal transforms are applied to sprites.

7. **Portal reopening handled one cell only**
   - Multi-cell portal objects could remain partly blocked.
   - The complete portal bounds are reopened after collision compilation.

8. **Collision geometry limited to plain rectangles**
   - Rotated objects and other object shapes were not handled consistently.
   - Collision compilation now uses conservative axis-aligned bounds for rectangles, ellipses, points, polygons, polylines, and rotated objects.

9. **Missing textures changed ordering behavior**
   - Generated fallbacks were asset-specific and rendered separately.
   - Missing tiles now use generic deterministic placeholders inserted in normal tile order.

## Compatibility contract

- Finite orthogonal maps.
- Tile, object, and group layers.
- JSON arrays, CSV, base64, zlib, and gzip tile data.
- Embedded tilesets and external JSON `.tsj` tilesets.
- Unsupported infinite chunks, image layers, TSX/XML, zstd, isometric, staggered, and hexagonal rendering fail fast.

## Validation

- Added client and server tests for nested groups, offsets, generic large footprints, complete GID masking, portal reopening, and malformed layer data.
- Migrated the existing Greenfields large-object metadata to the same generic tileset contract.
- Kept frontend and backend map copies synchronized.

## Self-review

- No runtime branch depends on tree layer names or tree GIDs.
- GID lookup clears all four Tiled high flags.
- External image paths resolve relative to the `.tsj` file.
- Failed map loads clear the frontend repository cache.
- Client preview and authoritative backend use equivalent collision and portal rules.
- `manifest.json` remains only as a compatibility fallback.
