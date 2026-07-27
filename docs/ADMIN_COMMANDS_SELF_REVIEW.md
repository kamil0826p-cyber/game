# Self-review: administrator chat commands

## Findings addressed before publication

1. **Role trust boundary** — the implementation does not trust the frontend, Firebase custom claims, or a role cached at login. PostgreSQL is queried inside every command transaction and only `ADMIN` is accepted.
2. **Duplicate delivery** — Socket.IO acknowledgements can be retried. The ledger operation ID includes administrator user ID and request ID, and a transaction advisory lock serializes duplicate requests.
3. **Auditability** — every successful grant writes actor user ID, actor character ID, request ID, command and target metadata to `CharacterCurrencyLedger` in the same transaction as the balance mutation.
4. **Realm isolation** — target lookup uses the current session realm plus character name.
5. **Integer safety** — positive integer parsing, a per-command maximum, and an explicit PostgreSQL integer overflow guard are enforced.
6. **Online consistency** — an online target's authoritative in-memory balance is updated after commit and the player receives a notification.
7. **Command secrecy** — slash commands are routed to `admin:command` and are never emitted as normal chat messages.
8. **Extensibility** — parsing, dispatch, authorization and command mutation are separate. New commands implement `AdminCommandHandler` and are registered centrally.

## Residual considerations

- Character names are currently matched exactly, consistent with the database unique key. Case-insensitive lookup would require a schema/index decision.
- The current user-facing command messages are Polish. They can be moved into the existing localization dictionaries when more admin commands are added.
- A future admin audit screen should read the existing currency ledger instead of introducing a second audit store.
