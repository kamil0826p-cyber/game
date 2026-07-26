# Frontend Socket Integration

## Connection

```ts
io(`${VITE_GAME_SERVER_URL}/game`, {
  path: VITE_SOCKET_PATH,
  transports: ['websocket'],
  auth: async (callback) => {
    callback({
      token: await firebaseUser.getIdToken(),
      locale: activeLocale,
    });
  },
});
```

The client enables automatic reconnection with bounded backoff. A reconnect attempt requests a refreshed Firebase ID token. `pagehide` disconnects the socket explicitly; Socket.IO heartbeat detection covers abrupt network loss. In both cases, the backend disconnect lifecycle captures and persists the authoritative runtime snapshot.

## Server events consumed

| Event | Client action |
|---|---|
| `session:ready` | Stores realm metadata and decides whether creation is required. |
| `character:required` | Opens the character creator with server-allowed classes. |
| `world:spawn` | Reconciles self, map, visible players, outfits, and movement interval. |
| `world:playerEntered` | Adds a visible remote player. |
| `world:playerMoved` | Interpolates a visible remote player toward the new tile. |
| `world:playerLeft` | Removes the remote player view. |
| `movement:committed` | Reconciles local position and consumes route-preview steps. |
| `movement:rejected` | Snaps intent state to the authoritative position and clears the route. |
| `world:mapChanged` | Replaces the map and visible-player snapshot, then runs the portal fade. |
| `notification` | Displays an English server notification. |

## Client commands emitted

| Event | Purpose |
|---|---|
| `character:create` | Creates the one realm character after Firebase authentication. |
| `movement:step` | Requests exactly one cardinal step. |
| `movement:target` | Requests server-side movement toward a target tile. |
| `movement:stop` | Cancels a scheduled path. |
| `visibility:viewport` | Reports current screen tile extents for interest management. |

All mutating requests use acknowledgements and an 8-second client timeout. Acknowledgements are treated as command results, while broadcast events remain the canonical stream for visibility and cross-client synchronization.
