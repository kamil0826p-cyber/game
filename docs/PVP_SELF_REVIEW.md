# PvP implementation self-review

## Invariants checked

- The production `CombatEngine` is unchanged and remains the only combat resolver.
- Existing `combat:request` and `combat:respond` events keep their payloads; policy is inserted behind the gateway.
- Teams are recorded from the actual combat snapshot, not trusted client input.
- SAFE, OUTLAW, and PVP retain their existing core meanings.
- No team can exceed the existing ten-player combat limit.
- Notoriety is never added for a legal duel, bounty, ranked match, objective match, or PVP-zone aggression.
- Bounty escrow and currency ledger operations are transactional.
- Bounty operation IDs are fingerprinted against target, amount, and duration; concurrent retries cannot double-debit.
- Rating, reward, replay, and settlement use database uniqueness constraints for exactly-once behavior.
- Repeated opponent cooldown is finite; after it expires, diminishing/no reward applies instead of an indefinite block.
- Reports are limited to participants in the referenced combat.
- Risk signals are evidence for review only and do not automatically ban.
- Replay event ordering is canonical and checksum-stable.
- Season rewards reject permanent power grants.

## Failure handling

- If policy persistence fails immediately after combat activation, the integration service attempts to terminate the newly started combat instead of allowing an untracked result.
- Settlement errors are logged and do not corrupt the combat engine. The unique settlement key makes retry safe.
- Internal combat observers are isolated so one listener cannot prevent socket delivery.
- Expiry, cancellation, and claim lock or conditionally update bounty status before financial settlement.
- Currency writes reject integer overflow.

## Tests added

- explicit zone semantics;
- legal and illegal aggression;
- 1v1 through 10v10 mode definitions;
- objective terminal condition;
- invalid roster sizes;
- newcomer, spawn, reconnect, defeat, combat, and repeated-pair protection;
- diminishing rewards;
- full-premade mismatch and explicit opt-in;
- bounded queue expansion;
- rating placement and soft reset;
- normalization preview retaining build ratios;
- support/objective eligibility and AFK exclusion;
- non-power seasonal rewards;
- deterministic replay checksum;
- deterministic escrow split and stable operation IDs;
- production combat integration preflight, consensual OUTLAW flow, and settlement observation.

## Deliberate boundaries

- Objective movement is turn/event based; no live-action arena movement was introduced.
- Risk signals do not perform device fingerprinting or automatic punishment. They provide structured inputs for future moderation review.
- The bounty board exposes only region-level hints.
- Exact guarded NPC and guarded portal behavior is exposed as an authoritative profile consequence. Individual NPC/portal definitions can consume that policy when guarded variants are added; generic NPCs and portals are not globally disabled.
