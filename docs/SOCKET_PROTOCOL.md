# Socket Protocol

## Namespace and authentication

Namespace: `/game`

Transport: WebSocket only.

The handshake must include a Firebase ID token in `auth.token` or an HTTP `Authorization: Bearer` header. Missing and invalid credentials are rejected before the connection lifecycle creates a user or character session.

Every command that mutates or schedules state uses a client-generated `requestId` where applicable. Acknowledgements have one of these shapes:

```ts
type SocketAck<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: object } };
```

The canonical TypeScript definitions are in `src/contracts/socket.events.ts`, and untrusted payload validators are in `src/contracts/socket.schemas.ts`.

## Connection events sent by the server

### `session:ready`

Sent after Firebase user synchronization and realm resolution.

```ts
{
  realm: { id: string; slug: string; name: string };
  requiresCharacter: boolean;
  serverTime: number;
}
```

### `character:required`

Sent when the authenticated user has no character in the current realm.

```ts
{ allowedClasses: Array<'MAGE' | 'WARRIOR' | 'ARCHER'> }
```

### `world:spawn`

Sent after an existing or newly created character enters the world. It includes authoritative self state, map metadata, all currently visible players, unlocked outfits, and the movement interval.

## Client commands

### `character:create`

```ts
{
  requestId: string;
  name: string;
  characterClass: 'MAGE' | 'WARRIOR' | 'ARCHER';
}
```

Rules:

- Name length: 3 to 20 characters.
- First character must be an ASCII letter.
- Remaining characters may contain ASCII letters, digits, spaces, underscores, and hyphens.
- Only one character may exist for one user in one realm.

Acknowledgement data: the same payload sent by `world:spawn`.

### `movement:step`

```ts
{
  requestId: string;
  direction: 'NORTH' | 'EAST' | 'SOUTH' | 'WEST';
}
```

A successful acknowledgement contains the committed authoritative position. The server also emits `movement:committed` to the moving socket. A rejected move returns and emits a structured rejection with the authoritative position.

### `movement:target`

```ts
{
  requestId: string;
  targetX: number;
  targetY: number;
}
```

The acknowledgement confirms path acceptance and path length. It does not claim that the final tile has already been reached. Each path step is emitted separately through `movement:committed`. A dynamic obstruction, disconnect, direct step, stop command, map transition, or invalid step can terminate the remaining path.

### `movement:stop`

```ts
{ requestId?: string }
```

Acknowledgement data:

```ts
{ stopped: boolean }
```

An already executing step can complete; future scheduled path steps are cancelled.

### `visibility:viewport`

```ts
{
  requestId: string;
  halfWidth: number;
  halfHeight: number;
}
```

The server clamps both values to configured maximums and immediately reconciles visible players with enter and leave events.

## Movement events sent by the server

### `movement:committed`

```ts
{
  requestId?: string;
  source: 'DIRECT' | 'PATH';
  mapId: string;
  x: number;
  y: number;
  direction: 'NORTH' | 'EAST' | 'SOUTH' | 'WEST';
  serverTime: number;
  portalTransition?: {
    sourceMapId: string;
    destinationMapId: string;
    targetX: number;
    targetY: number;
  };
}
```

### `movement:rejected`

```ts
{
  requestId?: string;
  code: string;
  message: string;
  details?: object;
  retryAfterMs?: number;
  authoritative: {
    mapId: string;
    x: number;
    y: number;
    direction: 'NORTH' | 'EAST' | 'SOUTH' | 'WEST';
  };
}
```

Common codes include `MOVE_TOO_FAST`, `MOVE_OUT_OF_BOUNDS`, `MOVE_COLLISION`, `MOVE_TILE_OCCUPIED`, `MOVE_NO_PATH`, `MOVE_PATH_TOO_LONG`, and `MOVE_PATH_SEARCH_LIMIT`.

## Visibility events sent by the server

### `world:playerEntered`

Contains the full public state for a player that has entered the viewer's exact field of view.

### `world:playerMoved`

Contains the full current public state and `serverTime` for a player that remains visible after movement.

### `world:playerLeft`

```ts
{ characterId: string }
```

Sent when a player disconnects, changes map, or leaves the viewer's field of view.

### `world:mapChanged`

Sent to the moving player after an automatic portal transition. It contains new map metadata, authoritative self state, and a complete nearby-player replacement set.

## Notifications

`notification` carries server messages that are not command acknowledgements, including duplicate-session replacement.
