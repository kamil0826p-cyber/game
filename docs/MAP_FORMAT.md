# Map Format

Maps are standard finite, orthogonal JSON exports from Tiled. The authoritative copies live in `prisma/maps`; exact browser copies live in `frontend/public/maps`. Infinite chunked maps and compressed layer payloads are not accepted.

## Required root fields

```json
{
  "type": "map",
  "orientation": "orthogonal",
  "infinite": false,
  "width": 16,
  "height": 12,
  "tilewidth": 32,
  "tileheight": 32,
  "tilesets": [],
  "layers": []
}
```

All dimensions must be positive integers. Tile layers must use array-backed `data` with exactly `width * height` integer GIDs.

## Rendering bands

Every visible tile layer is rendered in its Tiled order. A string layer property controls which side of the character layer receives it:

```json
{
  "name": "renderBand",
  "type": "string",
  "value": "above"
}
```

- `below` or an omitted property renders ground, paths, trunks, walls, and decorations below players.
- `above` renders canopies, roofs, arches, and other occluders above players.

Object layers are metadata and are not drawn by the client map renderer.

## Collision sources

The frontend route preview and authoritative backend compile the same tile-sized collision grid. The server remains the security boundary. Collision sources are combined with logical OR.

### Collision tile layer

A tile layer is treated as collision data when its name is `collision`, case-insensitive, or it has a boolean `collision=true` property. GID `0` is walkable; every non-zero GID is blocked.

### Collision object layer

An object layer named `collisions`, or one with `collision=true`, may contain axis-aligned rectangles. Every map tile touched by a rectangle becomes blocked. This is the preferred format for tree trunks, rocks, walls, and irregular map boundaries.

### Tileset tile property

A tile definition may contain:

```json
{
  "id": 5,
  "properties": [{ "name": "collides", "type": "bool", "value": true }]
}
```

Every placed GID corresponding to that local tile ID becomes blocked.

At least one collision source is required. Portal source cells are explicitly reopened after collision compilation so a portal may be embedded in a blocked map boundary.

## Portal layers

Portal objects are stored in an object layer named `portals`, case-insensitive, or one with `portals=true`.

```json
{
  "type": "portal",
  "x": 480,
  "y": 192,
  "width": 32,
  "height": 32,
  "properties": [
    { "name": "destinationMapKey", "type": "string", "value": "crystal-cave" },
    { "name": "targetX", "type": "int", "value": 1 },
    { "name": "targetY", "type": "int", "value": 6 }
  ]
}
```

When `sourceX` or `sourceY` is omitted, it is derived from the object's pixel position divided by the map tile dimensions. The seed normalizes embedded portal objects into database `Portal` rows; runtime transitions use those rows rather than trusting browser data.

## Runtime validation

Startup or seeding fails for malformed dimensions, missing collision sources, blocked spawns, invalid portals, or destinations outside the map. Movement is validated against the compiled backend grid before every accepted step.

## Zones

The normalized `Map.zoneType` controls player overlap and future rules:

- `SAFE`: players may occupy and pass through the same tile.
- `OUTLAW`: player occupancy blocks movement.
- `PVP`: player occupancy blocks movement.
