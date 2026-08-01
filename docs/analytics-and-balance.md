# Product analytics, economy telemetry and balance simulation

## Architecture

Analytics consumes the durable `DomainEvent` stream. Gameplay services publish authoritative facts; they do not call an external analytics SDK. `AnalyticsIngestionService` materializes a versioned, privacy-filtered `AnalyticsEvent` and records its own inbox receipt. Provider delivery uses a separate durable queue, so a slow or unavailable provider cannot block combat, rewards, trade, movement, login or shutdown persistence.

The queue capacity is enforced inside a PostgreSQL advisory-lock transaction, including deployments with multiple application instances. The default provider is `disabled`: internal reports still work, but no data leaves the server. `stdout` is useful for local diagnostics. `http` sends bounded JSON batches and requires `ANALYTICS_HTTP_ENDPOINT`. Retry uses exponential backoff, stale claims are recovered after five minutes, exhausted deliveries become `DEAD`, and shutdown performs a bounded flush.

## Privacy contract

The envelope contains technical identifiers, server timestamps, content/client versions and sanitized properties. The sanitizer removes chat/message/text/body/content, email, Firebase identifiers, authorization data, tokens, cookies, credentials, secrets and private fields recursively, including camel-case keys such as `chatMessage` and `authToken`. Do not put such values into domain-event metadata. Raw chat is never an analytics source.

## Authoritative coverage

Database triggers emit idempotent domain events for account registration, character creation, guild membership and every `CharacterCurrencyLedger` entry. Runtime facts cover sessions, world/region entry, portal transitions, onboarding checkpoints, groups, combat lifecycle, accepted actions, skills, timeout, surrender, disconnect and shutdown. Existing domain events provide quests, choices, mobs, granted and skipped loot, items, trade, rewards and regional contribution. Crafting and expeditions have versioned event contracts ready for their feature modules.

## Reports and anomaly checks

```bash
npm run analytics -- funnel
npm run analytics -- retention
npm run analytics -- sessions
npm run analytics -- economy
npm run analytics -- inflation
npm run analytics -- supply
npm run analytics -- prices
npm run analytics -- rewards
npm run analytics -- trades
npm run analytics -- skipped-loot
npm run analytics -- crafting
npm run analytics -- combat
npm run analytics -- combat-modes
npm run analytics -- party-sizes
npm run analytics -- skills
npm run analytics -- queue
npm run analytics -- anomalies
```

The commands read stable database views:

- `AnalyticsFunnelDaily`: account → character → world → first combat → first choice → first group.
- `AnalyticsRetentionDaily`: D1, D7 and D30 return sessions by first-session cohort.
- `AnalyticsSessionHealthDaily`: session duration, median/P95, sessions per account and return gaps.
- `AnalyticsEconomyDaily`: currency sources, sinks, net flow and reconciliation gap against the authoritative ledger.
- `AnalyticsCurrencyInflationDaily`: daily and cumulative net issuance with day-over-day growth.
- `AnalyticsCurrencySupplyCurrent`: current silver and gold supply held by characters.
- `AnalyticsItemPrices`: configured buy/sell prices and sell-to-buy ratio.
- `AnalyticsRewardFlowsDaily`: item, reputation, XP, contribution and other audited reward sources, sinks and net flow.
- `AnalyticsTradeDaily`: completed trade count, participants and silver volume.
- `AnalyticsSkippedLootDaily`: loot rejected because the inventory could not accept it.
- `AnalyticsCraftingDaily`: recipe volume and unique crafters once crafting emits `CraftCompleted`.
- `AnalyticsCombatHealthDaily`: duration, turns, party size, surrender/disconnect and skill usage.
- `AnalyticsCombatHealthByModeDaily`: the same combat metrics split by PVE/PVP mode, zone and server-derived difficulty.
- `AnalyticsCombatPartySizeDaily`: distribution and health metrics for party sizes from solo to ten-player teams.
- `AnalyticsSkillPerformanceDaily`: uses, damage, healing, absorbed shields, dodges and status applications per skill.
- `AnalyticsQueueHealth`: queue depth, oldest work and maximum attempts.
- `AnalyticsAnomalies`: non-zero economy reconciliation and dead deliveries.

Sampling is deterministic by event ID. Critical funnel, combat-resolution and currency events are never sampled out. Configure non-critical sampling with `ANALYTICS_SAMPLE_BASIS_POINTS`; configure deletion with `ANALYTICS_RETENTION_DAYS`.

## Feature flags and experiments

Definitions and assignments are persistent and versioned. Assignment uses a salted SHA-256 bucket and remains stable for the same subject and version. A disabled or missing experiment safely resolves to `control`. Assignment scope may be an account, character, realm, group or guild.

Variant weights, rollout and salt are immutable inside one experiment version. Change them by creating a new version; only status and schedule can be changed in place. This prevents silent reassignment of existing players.

```bash
npm run analytics -- experiment:set \
  --key=onboarding-v2 --version=1 --status=active --rollout=5000 \
  --variants=control:5000,guided:5000

npm run analytics -- experiment:disable --key=onboarding-v2
```

## Deterministic balance simulator

The simulator imports the production `CombatEngine` and skill catalog directly. It never imports Prisma, reward services or domain-event publishers. A side contains one or more fighter profiles with counts whose total is between 1 and 10. A suite may contain solo, homogeneous and mixed-composition scenarios and runs them in one reproducible report.

```bash
npm run balance:simulate -- run --input=prisma/balance.example.json
npm run balance:simulate -- compare \
  --input=artifacts/balance/baseline.json \
  --candidate=artifacts/balance/candidate.json \
  --output=artifacts/balance/report.json
```

Reports include compositions, team win counts, draws/timeouts, average turns, estimated duration, dominant actions, per-skill usage and effectiveness, plus baseline-to-candidate deltas for every scenario. The included reference suite covers solo, mixed 3v3 and mixed 10v10. Scenario inputs are plain JSON and simulation has no database write path.
