# Map Format

Maps are authored in Tiled and committed as static JSON. The authoritative server copy lives in `prisma/maps`; the browser copy lives in `frontend/public/maps`. Keep both copies synchronized.

## Supported Tiled settings

The runtime accepts finite orthogonal maps with positive dimensions. Supported layers are `tilelayer`, `objectgroup`, and `group`. Parent group visibility, opacity, `renderBand`, tile offsets (`x`, `y`), and pixel offsets (`offsetx`, `offsety`) are inherited by child layers.

Supported tile data formats:

- JSON integer arrays,
- CSV strings,
- base64 without compression,
- base64 with `zlib` or `gzip`.

Infinite maps, image layers, zstd, TSX/XML tilesets, and non-orthogonal orientations fail fast.

## Export workflow

1. Create a finite orthogonal map in Tiled.
2. Save/export JSON (`.json` or `.tmj`).
3. Prefer embedded tilesets. External tilesets must be JSON `.tsj` files.
4. Copy maps and external `.tsj` files to both `prisma/maps` and `frontend/public/maps`, preserving relative paths.
5. Keep image paths relative to the map or tileset file.
6. Add a new playable map to the seed configuration.
7. Run `npm test`, `npm run frontend:test`, and `npm run frontend:build`.
8. Run `npm run prisma:seed` after map metadata, dimensions, portals, or collisions change.

The frontend builds textures from Tiled tilesets. `frontend/public/assets/manifest.json` is only a legacy fallback.

## Rendering

Visible tile layers render in Tiled order. `right-down`, `right-up`, `left-down`, and `left-up` render orders are supported.

Use a string property on a layer or parent group:

```json
{ "name": "renderBand", "type": "string", "value": "above" }
```

- `below`, or omitted, renders below characters.
- `above` renders canopies, roofs, arches, and other occluders above characters.

Property names are matched case-insensitively.

### Large and offset tiles

There is no tree-specific path. Any tileset tile may define generic render metadata:

```json
{
  "id": 12,
  "properties": [
    { "name": "renderWidthTiles", "type": "float", "value": 3.0 },
    { "name": "renderHeightTiles", "type": "float", "value": 2.5 },
    { "name": "renderAnchorX", "type": "float", "value": 0.5 },
    { "name": "renderAnchorY", "type": "float", "value": 1.0 },
    { "name": "renderOffsetXTiles", "type": "float", "value": 0.5 },
    { "name": "renderOffsetYTiles", "type": "float", "value": 1.0 }
  ]
}
```

Dimensions and offsets use map-tile units; anchors are normalized sprite coordinates. The same mechanism works for trees, buildings, statues, gates, rocks, and roofs. Without custom values, tileset dimensions, per-tile image dimensions, and `tileoffset` provide defaults.

All four Tiled high-bit flags are removed before GID lookup. Orthogonal horizontal, vertical, and diagonal sprite transforms are supported.

## Tileset assets

Embedded atlas tilesets support `image`, image dimensions, tile dimensions, `columns`, `tilecount`, `margin`, `spacing`, and `tileoffset`. Image-collection tilesets with per-tile images and multiple tilesets are supported.

External tileset example:

```json
{ "firstgid": 1, "source": "tiles/world.tsj" }
```

Image paths inside it resolve relative to the `.tsj` file.

## Collision

The frontend route preview and authoritative backend compile equivalent tile-sized collision grids.

### Collision layer

A tile layer named `collision`, or one with `collision=true`, blocks every non-zero placed tile. An object layer named `collisions`, or one with `collision=true`, blocks cells touched by its objects.

Object geometry uses conservative axis-aligned bounds and supports rectangles, rotated rectangles, ellipses, points, polygons, and polylines.

### Simple collidable tile

```json
{
  "id": 5,
  "properties": [
    { "name": "collides", "type": "bool", "value": true }
  ]
}
```

### Generic large-tile footprint

Use Tiled's tile collision editor. Its exported `objectgroup` is applied to every placed tile instance:

```json
{
  "id": 12,
  "objectgroup": {
    "type": "objectgroup",
    "name": "Collision",
    "objects": [
      { "x": -32, "y": -32, "width": 96, "height": 64 }
    ]
  }
}
```

This replaces the previous tree-specific footprint and works for every oversized tile.

The backend requires at least one collision source. Portal rectangles are reopened after all collision sources are combined.

## Portals

Portal objects live in an object layer named `portals`, or one with `portals=true`:

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

When `sourceX`/`sourceY` are omitted, they are derived from object position including inherited offsets. The full portal rectangle is walkable. The seed normalizes portals into database rows.

## Zones

- `SAFE`: players may share a tile.
- `OUTLAW`: player occupancy blocks movement.
- `PVP`: player occupancy blocks movement.
