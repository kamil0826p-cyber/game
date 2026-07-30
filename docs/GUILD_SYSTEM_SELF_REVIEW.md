# Guild system — self-review

## Scope

- one guild membership per character and guild names/tags unique per realm;
- leader, officer and member roles;
- creation, invitations, acceptance/decline, description editing, promotion/demotion, kick, leadership transfer, leave and disband;
- 60-member cap and seven-day invitations;
- realtime guild snapshots and a guild-only chat tab;
- Polish and English server errors and bilingual client UI.

## Security and consistency review

- Every command derives the acting character from the authenticated in-world socket session.
- The server re-reads membership and role inside a transaction before every privileged mutation; client-side buttons are presentation only.
- Guild writes lock the guild row. This serializes concurrent invite acceptance, role changes, kicks, leadership transfer and disband.
- Guild creation locks the realm row before checking unique name/tag conflicts.
- Database constraints enforce one membership per character, one leader per guild, unique name/tag per realm and one pending invitation per guild/target pair.
- Acceptance checks the member cap after acquiring the guild lock, preventing concurrent requests from exceeding 60 members.
- Officers can invite, edit the description and remove members, but cannot manage leaders or other officers.
- Guild chat resolves membership on every send and broadcasts only to currently connected members of that exact guild.
- The client clears cached guild messages when membership or guild identity changes, preventing messages from a previous guild from remaining visible.
- Guild chat uses the same 750 ms interval, burst control, Unicode normalization, control-character stripping and request-id idempotency principles as global/local chat.

## Deliberate limits

- Guild experience and level are stored and exposed, but earning rules are not invented yet because no guild-activity specification was provided.
- Chat history is realtime-only, matching the existing global/local chat implementation. Persistence and pagination can be added as a separate moderation/history feature.
- There is no creation fee or minimum character level because no economy rule was specified.
