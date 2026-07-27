# Tiled map format

Maps are native finite orthogonal JSON exported by Tiled. The same file is committed in `prisma/maps` for the authoritative backend and in `frontend/public/maps` for rendering and route previews.

## Supported features

- Embedded image tilesets, with any number of tilesets per map.
- Tile layers, object layers and nested group layers.
- Inherited visibility, opacity, offsets, collision flags, portal flags and render planes.
- Tiled horizontal, vertical and diagonal GID flags.
- Tile-layer and rectangular object-layer collision combined with logical OR.

External `.tsx` or `.tsj` references are intentionally unsupported. Embed tilesets before committing a map so the database seed remains self-contained.

## Rendering planes

Layers render below entities by default. A layer or parent group renders above players and NPCs when it has:

```json
{ "name": "renderPlane", "type": "string", "value": "above-entities" }
```

This separates visual coverage from collision. Tree crowns and roofs can cover a character while only trunks and walls block movement.

## Collision

A tile or object layer is a collision source when its name is `collision` or `obstacles`, or it has `collision=true`. Zero GIDs are walkable and non-zero GIDs are blocked. Collision objects must be positive-size, unrotated rectangles; unsupported shapes fail during compilation rather than being silently approximated.

Hidden collision layers remain authoritative.

## Portals

Portal objects belong to an object layer named `Portals` or marked `portals=true`. Their class is `Portal`. Required properties are `destinationMapKey`, `targetX` and `targetY`. Source coordinates are derived from object position unless explicit `sourceX` and `sourceY` properties are supplied.

## Editing workflow

1. Open files from `prisma/maps` in Tiled.
2. Keep maps finite, orthogonal and on a 32×32 grid.
3. Embed every tileset.
4. Put terrain in `Below entities` and leaves, roofs or arches in `Above entities`.
5. Draw precise hitboxes in hidden collision layers.
6. Copy the saved JSON byte-for-byte to `frontend/public/maps`.
7. Run `npm run check:all`.
