# Administrator chat commands

Messages beginning with `/` are routed by the client to the dedicated `admin:command` WebSocket handler and are never broadcast as normal chat.

## Supported commands

```text
/add <character name> silver <amount>
/add <character name> gold <amount>
```

Character names may contain spaces. Amounts must be positive integers up to `1,000,000,000`.

## Security model

- Firebase still authenticates the socket.
- The command handler requires an active in-world session.
- The `ADMIN` role is read from PostgreSQL again inside every command transaction; client claims and cached role values are not trusted.
- The target character is constrained to the administrator's current realm.
- Currency mutation and ledger creation happen in one serializable transaction.
- `requestId` becomes an idempotency key. Replaying the same request returns the original result; reusing it for different arguments is rejected.
- A PostgreSQL transaction advisory lock prevents concurrent duplicate execution.
- The mutation guards against PostgreSQL `Int` overflow.
- Every grant is recorded in `CharacterCurrencyLedger` with actor, command, target and request metadata.

## Extending the system

Add a class implementing `AdminCommandHandler`, register it in `AdminCommandService`, and keep parsing, authorization and mutation logic outside the chat gateway.
