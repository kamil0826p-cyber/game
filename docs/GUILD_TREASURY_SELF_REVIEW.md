# Guild treasury and progression — self-review

## Scope

The guild module now contains a shared silver treasury, ten experience-upgrade tiers, an immutable operation history, contribution statistics and guild-wide mob statistics. Every member may deposit silver. Only the current guild leader may withdraw silver or purchase upgrades.

## Economy and upgrade curve

Each tier adds 2% experience from eligible mob kills, for a maximum of 20% at tier 10. Upgrade prices are deliberately convex so the first tiers are attainable by a new guild while the last tiers remain long-term collective goals:

| Tier | Cost | Total bonus |
| ---: | ---: | ---: |
| 1 | 25,000 | 2% |
| 2 | 60,000 | 4% |
| 3 | 125,000 | 6% |
| 4 | 225,000 | 8% |
| 5 | 375,000 | 10% |
| 6 | 600,000 | 12% |
| 7 | 900,000 | 14% |
| 8 | 1,300,000 | 16% |
| 9 | 1,800,000 | 18% |
| 10 | 2,500,000 | 20% |

Total cost: 7,910,000 silver.

## Authorization review

| Action | Member | Officer | Leader |
| --- | :---: | :---: | :---: |
| View treasury and history | Yes | Yes | Yes |
| Deposit silver | Yes | Yes | Yes |
| Withdraw silver | No | No | Yes |
| Buy XP upgrade | No | No | Yes |

Permissions are checked again inside the database transaction after the guild row is locked. A stale client role therefore cannot authorize a withdrawal or upgrade purchase.

## Transaction and concurrency review

- Guild mutations use `SELECT ... FOR UPDATE` on the guild row, serializing deposits, withdrawals and purchases for one guild.
- Character rows are also locked for deposits and withdrawals.
- Every command uses the socket request ID as an operation ID. `(guildId, operationId)` is unique, making retries idempotent.
- A repeated operation ID must match the original actor, amount and operation type. Reusing it with different data is rejected.
- Character silver, treasury balance, aggregate counters and the history row are changed in one Prisma transaction.
- The gateway executes commands through the existing per-character movement serializer and refreshes the active session's silver from the authoritative snapshot.
- Integer boundary checks reject operations that would overflow PostgreSQL `INTEGER` balances or economy totals.
- Database check constraints prevent negative balances and invalid upgrade tiers even if application validation regresses.

## Mob reward review

The bonus is applied in `MobRewardService`, after the existing level-difference eligibility rule and before character progression is saved. It therefore affects only experience that the mob would normally award. The bonus uses integer floor rounding, so rewards never produce fractional XP.

Guild/member kill counters and bonus-XP counters are updated in the same transaction as the encounter reward ledger. Existing reward idempotency means replaying an encounter does not duplicate guild statistics or XP.

## Added statistics and usability

- Treasury balance, lifetime deposits, withdrawals and upgrade spending.
- Last 20 treasury operations with actor, amount, resulting balance and time.
- Contribution total per member.
- Mob kills and bonus XP earned per member.
- Guild-wide mob kills, bonus XP granted, online count and average member level.
- A ten-step upgrade visualization with every price and the current +XP benefit.
- A warning that disbanding a guild destroys silver still left in the treasury.

## Tests and checks

Unit coverage was added for:

- the ten-tier price curve and maximum tier,
- 2%-per-tier XP calculations, cap and rounding,
- treasury amount limits,
- leader-only treasury management,
- strict deposit/withdraw/upgrade socket schemas.

The changed TypeScript and TSX files are syntax-transpiled during preparation. The repository CI remains the authoritative full typecheck, Prisma validation, backend tests and frontend tests because this environment does not have the repository dependency tree or database service available locally.

## Remaining product decisions

- There is intentionally no refund for purchased upgrades.
- A removed member keeps no personal claim on prior deposits; the immutable guild history retains the audit trail.
- Disbanding deletes the guild and its treasury history by cascade. The UI explicitly warns that remaining treasury silver is lost.
- Officers cannot spend treasury funds. A future permission system could introduce granular roles without changing the ledger model.
