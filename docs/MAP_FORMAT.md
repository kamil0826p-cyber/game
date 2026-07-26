# Map Format

Maps are stored in `Map.tiledData` as finite Tiled-compatible JSON. Phase 1 intentionally supports finite orthogonal tile maps with array-backed tile layers. Infinite chunked maps are not accepted yet.

## Required root fields

```json
{
  "type": "map",
  "width": 20,
  "height": 15,
  "tilewidth": 32,
  "tileheight": 32,
  "layers": []
}
```

All dimensions must be positive integers.

## Collision layers

At least one tile layer must be recognized as collision data. A layer is treated as collision when one of these rules matches:

- Its name is `collision`, case-insensitive.
- Its name is `obstacles`, case-insensitive.
- It contains a boolean Tiled property named `collision` with value `true`.

The layer dimensions and data length must exactly match the map. Tile value `0` is walkable. Any non-zero tile value is blocked.

Multiple collision layers are combined with logical OR.

## Portal layers

Portal objects can be stored in an object layer named `portals`, case-insensitive, or an object layer with a boolean `portals=true` property.

A portal object may provide explicit source coordinates:

```json
{
  "type": "portal",
  "properties": [
    { "name": "sourceX", "type": "int", "value": 18 },
    { "name": "sourceY", "type": "int", "value": 7 },
    { "name": "destinationMapKey", "type": "string", "value": "crystal-cave" },
    { "name": "targetX", "type": "int", "value": 2 },
    { "name": "targetY", "type": "int", "value": 7 }
  ]
}
```

When `sourceX` or `sourceY` is omitted, the seed importer derives it from the object's pixel position divided by `tilewidth` or `tileheight`.

The seed process normalizes embedded portal objects into `Portal` rows. Runtime transitions use those normalized rows rather than trusting client map data.

## Runtime validation

Application startup fails when any of these conditions is found:

- Missing or malformed collision data.
- Database dimensions do not match Tiled dimensions.
- A map spawn is outside the map or blocked.
- A portal source is outside the map or blocked.
- A portal destination map does not exist in the realm.
- A portal target is outside the destination map or blocked.

Fail-fast startup prevents a partially invalid map set from serving players.

## Zones

The normalized `Map.zoneType` field controls player overlap and future rules:

- `SAFE`: players may occupy and pass through the same tile.
- `OUTLAW`: player occupancy blocks movement; future outlaw rules are not implemented.
- `PVP`: player occupancy blocks movement; future PvP combat rules are not implemented.
