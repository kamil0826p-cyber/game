# Map Format

Maps are authored manually in Tiled and committed as static JSON files. Nothing in the application generates or overwrites map files during start, build, test, or seed commands.

The authoritative server copy lives in `prisma/maps`. The exact browser copy lives in `frontend/public/maps`. Whenever a map is exported from Tiled, place the same JSON content in both directories under the same file name.

## Supported Tiled project settings

The runtime accepts finite, orthogonal maps:

```json
{
  "type": "map",
  "orientation": "orthogonal",
  "infinite": false,
  "width": 96,
  "height": 64,
  "tilewidth": 32,
  "tileheight": 32,
  "tilesets": [],
  "layers": []
}
```

All dimensions must be positive integers. Every tile layer must match the root map dimensions.

Supported tile data formats are:

- a normal JSON integer array,
- Tiled `base64` encoding without compression,
- Tiled `base64` encoding with `zlib` compression,
- Tiled `base64` encoding with `gzip` compression.

Infinite chunked maps are not supported. Supported layer types are `tilelayer` and `objectgroup`.

## Manual export workflow

1. Open or create the map in Tiled.
2. Use an orthogonal, finite map.
3. Export or save the map as JSON (`.json` or `.tmj`).
4. Copy the exported content to both:
   - `prisma/maps/<map-key>.json`
   - `frontend/public/maps/<map-key>.json`
5. Keep the map key and file name synchronized with the database seed and frontend map repository.
6. Run `npm test` and `npm run frontend:test` before seeding.
7. Run `npm run prisma:seed` when map dimensions, portals, or map metadata changed.

The application never regenerates these files. Manual Tiled edits remain intact.

## Rendering bands

Visible tile layers are rendered in their Tiled order. A custom string property controls whether a layer is below or above characters:

```json
{
  "name": "renderBand",
  "type": "string",
  "value": "above"
}
```

- `below`, or an omitted property, renders the layer below players and NPCs.
- `above` renders canopies, roofs, arches, and other occluders above characters.

Object layers are metadata and are not drawn by the normal tile renderer.

## Collision sources

The frontend route preview and authoritative backend compile the same tile-sized collision grid. The backend remains the security boundary. Collision sources are combined with logical OR.

### Collision tile layer

A tile layer is collision data when its name is `collision`, case-insensitive, or when it has a boolean `collision=true` property. GID `0` is walkable and every non-zero GID is blocked.

### Collision object layer

An object layer named `collisions`, or one with `collision=true`, may contain axis-aligned rectangles. Every map tile touched by a rectangle becomes blocked.

### Tileset tile property

A tile definition may contain:

```json
{
  "id": 5,
  "properties": [
    { "name": "collides", "type": "bool", "value": true }
  ]
}
```

Every placed GID corresponding to that local tile ID becomes blocked. Tiled flip flags are ignored when resolving collision identity.

At least one collision source is required. Portal source cells are reopened after collision compilation so a portal may be embedded in a blocked map boundary.

## Portal layers

Portal objects are stored in an object layer named `portals`, case-insensitive, or one with `portals=true`.

```json
{
  "type": "portal",
  "x": 3040,
  "y": 1024,
  "width": 32,
  "height": 32,
  "properties": [
    { "name": "destinationMapKey", "type": "string", "value": "crystal-cave" },
    { "name": "targetX", "type": "int", "value": 1 },
    { "name": "targetY", "type": "int", "value": 32 }
  ]
}
```

When `sourceX` or `sourceY` is omitted, it is derived from the object's pixel position divided by the map tile dimensions. The seed normalizes portal objects into database `Portal` rows.

## Tileset assets

The sample maps use an embedded tileset definition pointing to:

```text
../assets/tiles/tiled-world.svg
```

The frontend also maps GIDs to textures through `frontend/public/assets/manifest.json`. When replacing the tileset image, dimensions, columns, or GID layout, update the manifest as well.

For convenient editing, open the copy under `frontend/public/maps`, where the relative image path resolves to `frontend/public/assets/tiles`. The backend copy is used for parsing and collision authority and does not need to resolve the image visually.

## Runtime validation

Startup or seeding fails for malformed dimensions, unsupported layer types, invalid compressed data, missing collision sources, blocked spawns, invalid portals, or destinations outside the map. Movement is validated against the compiled backend grid before every accepted step.

## Zones

The normalized `Map.zoneType` controls player overlap and future rules:

- `SAFE`: players may occupy and pass through the same tile.
- `OUTLAW`: player occupancy blocks movement.
- `PVP`: player occupancy blocks movement.
