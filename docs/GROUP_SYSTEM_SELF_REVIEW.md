# Group system and UI fixes — self-review

## Scope

- show realtime guild invitation notifications even when the guild window has never been opened;
- highlight the nameplate of players belonging to the local character's guild;
- replace the two mob captions with one rank-coloured caption below the sprite, for example `Królik (2 lv.) Pomiot`;
- add player-to-player group invitations, acceptance and rejection;
- cap groups at 10 members;
- add a collapsible group panel below the player status panel with outfit, level, health, online state and administrator marker;
- assign every active group exactly one administrator, initially the player who created it;
- allow only the administrator to invite new members and remove existing non-admin members;
- show a dedicated two-person mark beside the world nickname of players in the local character's group;
- allow a member to leave a group; a remaining member is released when a two-person group dissolves.

## Reuse and architecture

- Group invitation distance uses the existing `isActorWithinInteractionRange` rule shared by combat and trade. No separate radius or duplicated coordinate rule was introduced.
- The frontend exposes `canInteractWithPlayer`, and both combat and trade delegate to it while preserving their own policy checks.
- Group lifecycle is isolated in `GroupService`, with a thin socket gateway and module-augmented client/server contracts, following the existing combat, trade and guild integration patterns.
- Client-side administrator visibility is centralized in `groupPermissions`; the server independently repeats every authorization check.
- Group and guild affiliation for nameplates are updated from their authoritative snapshots rather than inferred from displayed names or tags.
- Mob label text and rank colours are pure presentation helpers covered by a focused unit test.

## Security and consistency

- Every group command resolves the acting character from the authenticated in-world socket session.
- The server, not the client, enforces self-invite prevention, realm membership, online state, combat availability, shared interaction distance, one group per character, duplicate invitations, the 10-member cap and administrator-only mutations.
- Capacity is checked both when sending and accepting an invitation.
- Group mutations are synchronous in the single Node.js process, so invitation acceptance and membership updates cannot interleave between validation and commit.
- Invitations are short-lived (60 seconds), bound to the target character and removed after acceptance, rejection or expiry.
- A temporary acceptance failure does not consume the invitation, allowing a retry before expiry.
- Invitations sent by an administrator are invalidated if that administrator leaves or loses ownership of the group before acceptance.
- Kicking removes membership indexes and pushes a null group snapshot to the removed online player.
- An administrator cannot kick themselves; they must leave the group instead.
- Leaving removes membership indexes, promotes the oldest remaining member when the administrator leaves and dissolves groups with fewer than two members.
- Group creation and invitations are blocked while either participant is in combat. Group combat itself is deliberately not implemented in this stage.
- Socket snapshots are pushed to online members; the HUD also refreshes active groups and pending invitations periodically to keep health and online state current.

## Tests and verification

- backend rule tests cover the 10-member limit and invitation TTL;
- backend service tests cover acceptance-created groups, shared adjacent range, full groups, transient acceptance failures, administrator-only invites, kicking, administrator transfer, stale-invite invalidation and group dissolution;
- frontend tests cover administrator UI permissions, group nickname presence tracking, the complete mob label/rank colour mapping and guild membership presence tracking;
- all changed TypeScript and TSX files are parsed with TypeScript's compiler API as a syntax check;
- the changed-file set is reviewed for relative import resolution and contract symmetry before publication.

## Deliberate limits

- Group state is realtime and process-local, matching the current ephemeral combat/trade style. Persisted groups or multi-node shared state require a separate persistence/distribution design.
- This stage does not add group combat, shared loot, experience distribution, manual administrator transfer or group chat.
- Offline members remain visible so a reconnect can restore the group; automatic long-term offline eviction is left for a later group lifecycle policy.
