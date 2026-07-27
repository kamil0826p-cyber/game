# Tiled Map Workflow

The canonical map sources live in `frontend/public/maps`. Open the `.json` files directly in Tiled. Prisma seed imports those same files, so there is no backend copy to synchronize.

The runtime supports finite orthogonal JSON maps with uncompressed integer-array tile data. Infinite maps, base64/compressed layers, isometric maps, image layers, and object templates are rejected.

## Files

```text
frontend/public/maps/
├── greenfields.json
├── crystal-cave.json
└── tilesets/
    ├── greenfields.tsj
    └── crystal-cave.tsj

frontend/public/assets/tiles/
├── greenfields/
│   ├── 00-grass.svg
│   ├── 01-grass-flowers.svg
│   └── ... one file per tile
└── crystal-cave/
    ├── 00-floor.svg
    ├── 01-floor-rough.svg
    └── ... one file per tile
```

The example tilesets use Tiled's **Collection of Images** format. There is no tileset atlas image. Each tile entry in the external `.tsj` contains its own relative `image` path, so every graphic is independently editable and replaceable.

The frontend also supports conventional atlas tilesets, but the included maps intentionally use collections of separate files.

## Required map properties

Set these custom properties on the map root:

| Property | Type | Meaning |
| --- | --- | --- |
| `key` | string | Stable map key |
| `name` | string | Display name imported by Prisma seed |
| `zoneType` | string | `SAFE`, `OUTLAW`, or `PVP` |
| `spawnX` | int | Default spawn tile X |
| `spawnY` | int | Default spawn tile Y |
| `default` | bool | Must be `true` on exactly one map |

## Visual layers

Every visible tile layer is rendered in Tiled order. Group visibility, opacity, and offsets are inherited. Collision layers and layers with `render=false` are not rendered.

The loader supports:

- external and inline tilesets,
- atlas tilesets with a top-level `image`,
- collection-of-images tilesets with an `image` on each tile,
- Tiled horizontal, vertical, and diagonal GID flags.

Tile asset failures are not hidden. Missing images, malformed TSJ data, or map GIDs without corresponding graphics now produce a descriptive error instead of silently drawing a primitive checkerboard.

## Collision

A tile or object layer is collision data when its name is `collision`, `collisions`, or `obstacles`, or it has `collision=true`.

Every non-zero cell on a collision tile layer blocks that map tile. Axis-aligned rectangles on collision object layers block every overlapped tile. Keep collision layers hidden and set `render=false`.

## Portals

Create an object layer named `Portals`, or set `portals=true`. Portal objects use class/type `portal` and these properties:

| Property | Type | Required |
| --- | --- | --- |
| `destinationMapKey` | string | yes |
| `targetX` | int | yes |
| `targetY` | int | yes |
| `sourceX` | int | no |
| `sourceY` | int | no |

When source coordinates are omitted they are derived from the point object's pixel position.

## Replacing a tile graphic

1. Open the `.tsj` in Tiled.
2. Keep the tileset type as **Collection of Images**.
3. Replace the corresponding file under `frontend/public/assets/tiles/<tileset>/`.
4. Keep the tile ID stable when existing maps already use it.
5. Save the map as JSON.
6. Run `npm run prisma:seed` and frontend tests.

## Adding a map

1. Create a finite orthogonal JSON map in `frontend/public/maps`.
2. Create or reuse an external `.tsj` under `frontend/public/maps/tilesets`.
3. Add required root properties.
4. Add visible tile layers, collision data, and portals.
5. Run `npm run prisma:seed`.
6. Run backend and frontend map tests.

No TypeScript map registry needs editing. The browser loads `/maps/<key>.json`; Prisma seed discovers map files automatically.
