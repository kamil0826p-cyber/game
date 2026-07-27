# Tiled Map Workflow

The canonical map sources live in `frontend/public/maps`. Open the `.json` files directly in Tiled. The Prisma seed imports those same files, so there is no second backend copy to keep synchronized.

The current runtime supports finite orthogonal maps exported as JSON with uncompressed integer-array tile data. Infinite chunked maps, base64/compressed layer data, isometric orientation, image layers, and template objects are intentionally rejected with a clear startup error.

## Files

```text
frontend/public/maps/
├── greenfields.json
├── crystal-cave.json
└── tilesets/
    ├── greenfields.tsj
    └── crystal-cave.tsj

frontend/public/assets/tiles/
├── greenfields.svg
└── crystal-cave.svg
```

Map JSON references an external `.tsj` tileset. The `.tsj` image path is relative to the tileset file, which works both in Tiled and in the browser.

## Required map properties

Set these custom properties on the map root in Tiled:

| Property | Type | Meaning |
| --- | --- | --- |
| `key` | string | Stable map key used by database rows and socket payloads |
| `name` | string | Display name imported by Prisma seed |
| `zoneType` | string | `SAFE`, `OUTLAW`, or `PVP` |
| `spawnX` | int | Default spawn tile X |
| `spawnY` | int | Default spawn tile Y |
| `default` | bool | Must be `true` on exactly one map |

The seed scans every `.json` file in this directory, validates the properties, imports the map JSON, and normalizes embedded portals into database rows.

## Visual layers

Every visible tile layer is rendered in Tiled order. Group layers are supported, including inherited visibility, opacity, and pixel offsets.

A layer is omitted from rendering when any of these conditions applies:

- The layer or a parent group is hidden.
- Its effective opacity is zero.
- It is a collision layer.
- It has the boolean property `render=false`.

External and inline tilesets are supported. Tiled horizontal, vertical, and diagonal GID flags are stripped before texture lookup; simple flip transforms are applied by the Pixi renderer.

## Collision

At least one collision source is required. A tile layer or object layer is treated as collision data when:

- Its name is `collision`, `collisions`, or `obstacles`, case-insensitive.
- It has a boolean property `collision=true`.

For tile layers, every non-zero cell blocks the corresponding map tile. Layer `x`/`y` offsets and tile-aligned group pixel offsets are respected. Non-aligned pixel offsets are rejected so the client and authoritative backend cannot disagree about collision.

For object layers, axis-aligned rectangles block every tile they overlap. This is useful for large walls or water regions without painting a full tile layer.

Multiple collision sources are combined with logical OR. Keep collision layers hidden in Tiled and add `render=false` for clarity.

## Portals

Create an object layer named `Portals`, or set `portals=true` on an object layer. Portal objects should use class or legacy type `portal` and define:

| Property | Type | Required |
| --- | --- | --- |
| `destinationMapKey` | string | yes |
| `targetX` | int | yes |
| `targetY` | int | yes |
| `sourceX` | int | no |
| `sourceY` | int | no |

When source coordinates are omitted, they are derived from the point object's pixel position. Place portal point objects exactly on the tile grid.

The seed rejects missing destinations, blocked source tiles, blocked target tiles, and out-of-bounds coordinates. The default map also contains a point object named `quartermaster`; moving that marker in Tiled moves Borin during the next seed.

## Adding a map

1. Create a finite orthogonal JSON map in `frontend/public/maps`.
2. Create or reuse an external `.tsj` tileset under `frontend/public/maps/tilesets`.
3. Add all required root properties.
4. Add visible tile layers, collision data, and portal objects.
5. Run `npm run prisma:seed` to import and validate the map set.
6. Run backend and frontend map tests before committing.

No TypeScript map registry needs editing. The browser loads `/maps/<key>.json`, while the backend seed discovers map files automatically.
