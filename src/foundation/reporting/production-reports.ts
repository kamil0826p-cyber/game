import { Prisma, PrismaClient } from '../../generated/prisma/client.js';

export interface FoundationReports {
  generatedAt: string;
  funnel: unknown[];
  retention: unknown[];
  sessions: unknown[];
  economy: {
    ledgerByReason: unknown[];
    reconciliation: unknown[];
  };
  itemFlow: unknown[];
  combat: {
    duration: unknown[];
    skills: unknown[];
    compositions: unknown[];
  };
  diagnostics: {
    content: unknown[];
    deadLetters: unknown[];
    auditDrift: unknown[];
  };
}

export async function accountFunnelReport(prisma: PrismaClient): Promise<unknown[]> {
  return prisma.$queryRaw(Prisma.sql`
    WITH stages("position", "stage", "eventType") AS (
      VALUES
        (1, 'account', 'account.created'),
        (2, 'character', 'character.created'),
        (3, 'world', 'world.map.entered'),
        (4, 'first_combat', 'combat.started'),
        (5, 'first_choice', 'quest.choice.made'),
        (6, 'first_group', 'group.created')
    )
    SELECT
      stages."position",
      stages."stage",
      stages."eventType",
      COUNT(DISTINCT COALESCE(event."accountId"::text, event."characterId"::text))::int AS "subjects"
    FROM stages
    LEFT JOIN "DomainEvent" event ON event."eventType" = stages."eventType"
    GROUP BY stages."position", stages."stage", stages."eventType"
    ORDER BY stages."position"
  `);
}

export async function retentionReport(prisma: PrismaClient): Promise<unknown[]> {
  return prisma.$queryRaw(Prisma.sql`
    WITH cohorts AS (
      SELECT
        COALESCE("accountId"::text, "characterId"::text) AS subject,
        MIN("occurredAt")::date AS cohort_date
      FROM "DomainEvent"
      WHERE "eventType" IN ('account.created', 'character.created')
        AND COALESCE("accountId"::text, "characterId"::text) IS NOT NULL
      GROUP BY COALESCE("accountId"::text, "characterId"::text)
    ), activity AS (
      SELECT DISTINCT
        COALESCE("accountId"::text, "characterId"::text) AS subject,
        "occurredAt"::date AS activity_date
      FROM "DomainEvent"
      WHERE "eventType" IN ('session.started', 'world.map.entered', 'combat.started')
        AND COALESCE("accountId"::text, "characterId"::text) IS NOT NULL
    )
    SELECT
      cohorts.cohort_date AS "cohortDate",
      COUNT(*)::int AS "cohortSize",
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM activity
        WHERE activity.subject = cohorts.subject
          AND activity.activity_date = cohorts.cohort_date + 1
      ))::int AS "d1",
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM activity
        WHERE activity.subject = cohorts.subject
          AND activity.activity_date = cohorts.cohort_date + 7
      ))::int AS "d7",
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM activity
        WHERE activity.subject = cohorts.subject
          AND activity.activity_date = cohorts.cohort_date + 30
      ))::int AS "d30"
    FROM cohorts
    GROUP BY cohorts.cohort_date
    ORDER BY cohorts.cohort_date DESC
  `);
}

export async function sessionDurationReport(prisma: PrismaClient): Promise<unknown[]> {
  return prisma.$queryRaw(Prisma.sql`
    WITH sessions AS (
      SELECT
        "sessionId",
        MIN("occurredAt") FILTER (WHERE "eventType" = 'session.started') AS started_at,
        MAX("occurredAt") FILTER (WHERE "eventType" = 'session.ended') AS ended_at
      FROM "DomainEvent"
      WHERE "sessionId" IS NOT NULL
        AND "eventType" IN ('session.started', 'session.ended')
      GROUP BY "sessionId"
    )
    SELECT
      COUNT(*) FILTER (WHERE ended_at IS NOT NULL)::int AS "completedSessions",
      COALESCE(AVG(EXTRACT(EPOCH FROM (ended_at - started_at))) FILTER (WHERE ended_at IS NOT NULL), 0)::float8 AS "averageSeconds",
      COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (ended_at - started_at))) FILTER (WHERE ended_at IS NOT NULL), 0)::float8 AS "medianSeconds",
      COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (ended_at - started_at))) FILTER (WHERE ended_at IS NOT NULL), 0)::float8 AS "p95Seconds"
    FROM sessions
  `);
}

export async function economyReport(prisma: PrismaClient): Promise<{
  ledgerByReason: unknown[];
  reconciliation: unknown[];
}> {
  const [ledgerByReason, reconciliation] = await Promise.all([
    prisma.$queryRaw(Prisma.sql`
      SELECT
        "currency",
        "direction",
        "reason",
        COUNT(*)::int AS "entries",
        SUM("amount")::bigint AS "amount"
      FROM "CharacterCurrencyLedger"
      GROUP BY "currency", "direction", "reason"
      ORDER BY "currency", "direction", "reason"
    `),
    prisma.$queryRaw(Prisma.sql`
      WITH ledger AS (
        SELECT
          "currency"::text AS currency,
          COUNT(*)::bigint AS entries,
          SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount" ELSE -"amount" END)::bigint AS net
        FROM "CharacterCurrencyLedger"
        GROUP BY "currency"
      ), events AS (
        SELECT
          "payload"->>'currency' AS currency,
          COUNT(*)::bigint AS entries,
          SUM(
            CASE WHEN "payload"->>'direction' = 'CREDIT'
              THEN ("payload"->>'amount')::bigint
              ELSE -("payload"->>'amount')::bigint
            END
          )::bigint AS net
        FROM "DomainEvent"
        WHERE "eventType" = 'economy.currency.changed'
        GROUP BY "payload"->>'currency'
      )
      SELECT
        COALESCE(ledger.currency, events.currency) AS "currency",
        COALESCE(ledger.entries, 0) AS "ledgerEntries",
        COALESCE(events.entries, 0) AS "eventEntries",
        COALESCE(ledger.net, 0) AS "ledgerNet",
        COALESCE(events.net, 0) AS "eventNet",
        COALESCE(ledger.entries, 0) = COALESCE(events.entries, 0)
          AND COALESCE(ledger.net, 0) = COALESCE(events.net, 0) AS "reconciled"
      FROM ledger
      FULL OUTER JOIN events USING (currency)
      ORDER BY COALESCE(ledger.currency, events.currency)
    `),
  ]);
  return { ledgerByReason, reconciliation };
}

export async function itemFlowReport(prisma: PrismaClient): Promise<unknown[]> {
  return prisma.$queryRaw(Prisma.sql`
    SELECT
      "eventType",
      "payload"->>'itemKey' AS "itemKey",
      COUNT(*)::int AS "events",
      SUM(
        GREATEST(
          0,
          COALESCE(("payload"->>'newQuantity')::int, 0) - COALESCE(("payload"->>'oldQuantity')::int, 0)
        )
      )::bigint AS "quantityIn",
      SUM(
        GREATEST(
          0,
          COALESCE(("payload"->>'oldQuantity')::int, 0) - COALESCE(("payload"->>'newQuantity')::int, 0)
        )
      )::bigint AS "quantityOut"
    FROM "DomainEvent"
    WHERE "eventType" LIKE 'item.%'
    GROUP BY "eventType", "payload"->>'itemKey'
    ORDER BY "itemKey", "eventType"
  `);
}

export async function combatReport(prisma: PrismaClient): Promise<{
  duration: unknown[];
  skills: unknown[];
  compositions: unknown[];
}> {
  const [duration, skills, compositions] = await Promise.all([
    prisma.$queryRaw(Prisma.sql`
      SELECT
        COUNT(*)::int AS "combats",
        COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY ("payload"->>'durationMs')::bigint), 0)::float8 AS "medianDurationMs",
        COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY ("payload"->>'durationMs')::bigint), 0)::float8 AS "p95DurationMs",
        COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY ("payload"->>'turnDurationMs')::bigint), 0)::float8 AS "medianTurnMs",
        COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY ("payload"->>'turnDurationMs')::bigint), 0)::float8 AS "p95TurnMs"
      FROM "DomainEvent"
      WHERE "eventType" = 'combat.finished'
        AND "payload" ? 'durationMs'
    `),
    prisma.$queryRaw(Prisma.sql`
      SELECT
        COALESCE("payload"->>'skillKey', 'basic-attack') AS "skillKey",
        COUNT(*)::int AS "uses",
        SUM(COALESCE(("payload"->>'damage')::bigint, 0))::bigint AS "damage",
        SUM(COALESCE(("payload"->>'healing')::bigint, 0))::bigint AS "healing",
        AVG(COALESCE(("payload"->>'success')::boolean, TRUE)::int)::float8 AS "successRate"
      FROM "DomainEvent"
      WHERE "eventType" = 'combat.action.accepted'
      GROUP BY COALESCE("payload"->>'skillKey', 'basic-attack')
      ORDER BY "uses" DESC
    `),
    prisma.$queryRaw(Prisma.sql`
      SELECT
        COALESCE(("payload"->>'teamSize')::int, 1) AS "teamSize",
        COALESCE("payload"->>'composition', 'unknown') AS "composition",
        COUNT(*)::int AS "combats",
        AVG(CASE WHEN "payload"->>'won' = 'true' THEN 1 ELSE 0 END)::float8 AS "winRate"
      FROM "DomainEvent"
      WHERE "eventType" = 'combat.finished'
      GROUP BY COALESCE(("payload"->>'teamSize')::int, 1), COALESCE("payload"->>'composition', 'unknown')
      ORDER BY "teamSize", "combats" DESC
    `),
  ]);
  return { duration, skills, compositions };
}

export async function diagnosticsReport(prisma: PrismaClient): Promise<{
  content: unknown[];
  deadLetters: unknown[];
  auditDrift: unknown[];
}> {
  const [content, deadLetters, auditDrift] = await Promise.all([
    prisma.$queryRaw(Prisma.sql`
      SELECT
        "sequence", "hash", "status", "createdAt", "activatedAt", "rolledBackAt", "logicalDiff"
      FROM "ContentRelease"
      ORDER BY "sequence" DESC
      LIMIT 50
    `),
    prisma.$queryRaw(Prisma.sql`
      SELECT
        event."eventType",
        COUNT(*)::int AS "deadLetters",
        MAX(outbox."lastError") AS "lastError",
        MAX(outbox."createdAt") AS "latestAt"
      FROM "DomainOutbox" outbox
      JOIN "DomainEvent" event ON event."id" = outbox."eventId"
      WHERE outbox."status" = 'DEAD'
      GROUP BY event."eventType"
      ORDER BY "deadLetters" DESC
    `),
    prisma.$queryRaw(Prisma.sql`
      SELECT
        'currency-ledger-vs-events' AS "audit",
        COUNT(*) FILTER (WHERE NOT "reconciled")::int AS "mismatches"
      FROM (
        WITH ledger AS (
          SELECT "currency"::text AS currency, COUNT(*)::bigint AS entries,
            SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount" ELSE -"amount" END)::bigint AS net
          FROM "CharacterCurrencyLedger" GROUP BY "currency"
        ), events AS (
          SELECT "payload"->>'currency' AS currency, COUNT(*)::bigint AS entries,
            SUM(CASE WHEN "payload"->>'direction' = 'CREDIT' THEN ("payload"->>'amount')::bigint ELSE -("payload"->>'amount')::bigint END)::bigint AS net
          FROM "DomainEvent" WHERE "eventType" = 'economy.currency.changed' GROUP BY "payload"->>'currency'
        )
        SELECT COALESCE(ledger.entries, 0) = COALESCE(events.entries, 0)
          AND COALESCE(ledger.net, 0) = COALESCE(events.net, 0) AS "reconciled"
        FROM ledger FULL OUTER JOIN events USING (currency)
      ) audit
    `),
  ]);
  return { content, deadLetters, auditDrift };
}

export async function buildFoundationReports(prisma: PrismaClient): Promise<FoundationReports> {
  const [funnel, retention, sessions, economy, itemFlow, combat, diagnostics] = await Promise.all([
    accountFunnelReport(prisma),
    retentionReport(prisma),
    sessionDurationReport(prisma),
    economyReport(prisma),
    itemFlowReport(prisma),
    combatReport(prisma),
    diagnosticsReport(prisma),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    funnel,
    retention,
    sessions,
    economy,
    itemFlow,
    combat,
    diagnostics,
  };
}
