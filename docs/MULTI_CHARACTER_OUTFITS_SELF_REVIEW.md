# Multi-character roster and outfits — self-review

## Scope

- A user may own up to five characters in the active realm.
- Character names remain unique inside a realm.
- The pre-world screen loads the full owned roster and allows switching the selected character.
- Outfit changes are persisted before entering the world and are accepted only for an owned character and an outfit unlocked at its level.
- Every class has eleven catalog entries: the starting image at level 1 and a new image every ten levels through level 100.
- Each outfit key resolves to one exact existing SVG sprite sheet for the selected character gender; the client does not recolor a shared base image at runtime.
- Male and female artwork is stored separately under `sprites/male` and `sprites/female`, and both directories contain 33 unique sheets.

## Authority and security review

- The client never supplies a user or realm identifier. Ownership is resolved from the authenticated socket user and the active realm.
- `character:select` queries by `id + userId + realmId`, preventing selection of another user's character.
- `character:outfit` repeats the same ownership check and validates class, level, and outfit key against the backend catalog.
- The five-character limit is checked inside the character-creation transaction.
- The old `userId + realmId` unique constraint is replaced by a non-unique lookup index; realm-wide character-name uniqueness remains intact.
- Outfit changes are blocked after the socket enters the world, preventing mid-session appearance changes through the pre-world command.
- Switching a prepared character removes the previous non-active world session before claiming the next character.

## Compatibility review

- Existing accounts keep all character rows and the earliest character remains the initially highlighted selection.
- Existing outfit keys remain valid; asset version 18 replaces their cached artwork without changing persisted keys.
- Existing character creation payloads remain accepted because `outfitKey` is optional server-side; the client saves the chosen level-1 outfit immediately after creation.
- `world:enter`, movement, combat, trade, inventory, persistence, and skill payloads are unchanged.
- Stored gender values remain compatible and now select the corresponding dedicated sprite sheet rather than a recolored shared image.

## Race and lifecycle review

- The database remains the source of truth for roster count, ownership, level, and outfit.
- Character creation checks the current count in the same transaction that inserts the row.
- A prepared but not-yet-active character session is removed before creating or selecting another character.
- Active in-world sessions cannot use roster selection or pre-world outfit mutation.
- Existing exclusive character claims still prevent the same character from being active on two sockets.

## Tests

- Backend catalog count, uniqueness, default/unlocked rules, maximum roster constant, and Zod schemas.
- Frontend catalog count, uniqueness, exact ten-level unlock ordering, gender-specific asset paths, physical sprite-file existence, dimensions, and hashes.
- Regression coverage verifies 66 unique high-resolution sheets and rejects cross-outfit or cross-gender fallback substitutions.

## Validation

Run the repository checks in a dependency-backed environment:

```bash
npm ci
npm --prefix frontend ci
npm run prisma:validate
npm run check:all
```
