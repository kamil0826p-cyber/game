# Combat round model

Status: accepted

## Decision

The default PVE and ordinary PVP format uses a **fast classical initiative queue**. A standard team contains 3–5 actors. Larger teams remain technically possible only through an explicitly configured special mode; they are not the default balancing target.

The server owns the queue, active actor, `turnStartedAt`, and `turnEndsAt`. The default decision window is 12 seconds and can be configured with `COMBAT_TURN_TIMEOUT_MS` within the validated 3–60 second range. When the deadline passes, the server performs the deterministic `BASIC_ATTACK` fallback against the first legal living target. A late command is rejected by the existing combat lock and turn validation rather than executing a second action.

## Alternatives considered

### Classical initiative queue

Advantages:

- matches the existing authoritative engine and snapshot format;
- one accepted command has one immediately understandable result;
- reconnect only needs the current snapshot and server deadline;
- AI and players use the same legal-action boundary;
- deterministic timeout handling is straightforward;
- easier combat log, animation sequencing, and debugging.

Costs:

- actors still wait for earlier turns;
- very large teams scale poorly, which is why ordinary groups are limited to five.

### Simultaneous planning

Advantages:

- lower theoretical waiting time for large groups;
- creates prediction and counter-planning opportunities.

Rejected for the current baseline because it requires hidden pending actions, conflict-resolution rules, cancellation semantics, more complex reconnect state, and significantly more difficult PVP readability. It can later be added as an explicit encounter mode without changing the default engine.

## Invariants

1. The server clock is authoritative; the client only renders the deadline.
2. An actor can resolve at most one action for a turn.
3. Timeout and a command arriving at the deadline are serialized by the combat lock.
4. The fallback action must select a legal living target or safely advance the turn.
5. Disconnecting an active actor cannot stop the combat loop.
6. A snapshot contains enough information to rebuild the queue and timer after reconnect.
7. Repeated visual effects may be accelerated or skipped locally, but the client may not skip authoritative state transitions.

## Telemetry

The backend event contract includes:

- `combat_started` with mode and participant count;
- `turn_timed_out` with combat ID and turn number;
- `combat_finished` with duration, turn count, timeout count, and finish reason.

Dashboards should expose median and P90 combat duration, median decision time, timeout rate, and results split by participant count.

## Testing matrix

- 1v1 and uneven teams;
- 3–5 player teams;
- command versus timeout race;
- active-player disconnect and reconnect;
- dead or unavailable default target;
- combat ending on the same tick as a timeout;
- server restart snapshot restoration when durable combat snapshots are enabled.
