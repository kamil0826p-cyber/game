# Product analytics, economy telemetry and balance simulation

## Architecture

Analytics consumes the durable `DomainEvent` stream. Gameplay services publish authoritative facts; they do not call an external analytics SDK. `AnalyticsIngestionService` materializes a versioned, privacy-filtered `AnalyticsEvent` and records its own inbox receipt. A provider delivery is a separate durable queue, so a slow or unavailable provider cannot block combat, rewards, trade, movement, login or shutdown persistence.

The default provider is `disabled`: internal reports still work, but no data leaves the server. `stdout` is useful for local diagnostics. `http` sends bounded JSON batches and requires `ANALYTICS_HTTP_ENDPOINT`. Retry uses exponential backoff, stale claims are recovered after five minutes, exhausted deliveries become `DEAD`, and shutdown performs a bounded flush.

## Privacy contract

The envelope contains technical identifiers, server timestamps, content/client versions and sanitized properties. The sanitizer removes chat/message/text/body/content, email, Firebase identifiers, authorization data, tokens, cookies, credentials, secrets and private fields recursively. Do not put such values into domain-event metadata. Raw chat is never an analytics source.

## Authoritative coverage

Database triggers emit idempotent domain events for account registration, character creation, guild membership and every `CharacterCurrencyLedger` entry. Runtime facts cover sessions, world/region entry, portal transitions, onboarding checkpoints, groups, combat start, accepted actions, skills, surrender and disconnect. Existing domain events provide quests, choices, mobs, loot, items, trade, rewards and regional contribution. Crafting and expeditions already have versioned event contracts ready for their feature modules.

## Reports and anomaly checks

```bash
npm run analytics -- funnel
npm run analytics -- retention
npm run analytics -- economy
npm run analytics -- combat
npm run analytics -- queue
npm run analytics -- anomalies
```

The commands read stable database views:

- `AnalyticsFunnelDaily`: account → character → world → first combat → first choice → first group.
- `AnalyticsRetentionDaily`: D1, D7 and D30 return sessions by first-session cohort.
- `AnalyticsEconomyDaily`: sources, sinks, net flow and reconciliation gap against the authoritative currency ledger.
- `AnalyticsCombatHealthDaily`: duration, turns, party size, surrender/disconnect and skill usage.
- `AnalyticsQueueHealth`: queue depth, oldest work and maximum attempts.
- `AnalyticsAnomalies`: non-zero economy reconciliation and dead deliveries.

Sampling is deterministic by event ID. Critical funnel, combat-resolution and currency events are never sampled out. Configure non-critical sampling with `ANALYTICS_SAMPLE_BASIS_POINTS`; configure deletion with `ANALYTICS_RETENTION_DAYS`.

## Feature flags and experiments

Definitions and assignments are persistent and versioned. Assignment uses a salted SHA-256 bucket and remains stable for the same subject and version. A disabled or missing experiment safely resolves to `control`.

```bash
npm run analytics -- experiment:set \
  --key=onboarding-v2 --version=1 --status=active --rollout=5000 \
  --variants=control:5000,guided:5000

npm run analytics -- experiment:disable --key=onboarding-v2
```

## Deterministic balance simulator

The simulator imports the production `CombatEngine` and skill catalog directly. It never imports Prisma, reward services or domain-event publishers. Scenarios support teams from 1 to 10, fixed seeds and thousands of fights.

```bash
npm run balance:simulate -- run --input=prisma/balance.example.json
npm run balance:simulate -- compare \
  --input=artifacts/balance/baseline.json \
  --candidate=artifacts/balance/candidate.json \
  --output=artifacts/balance/report.json
```

Reports include team win counts, draws/timeouts, average turns, estimated duration, basic/skill action counts, per-skill usage and baseline-to-candidate deltas. Scenario inputs are plain JSON and simulation has no database write path.
