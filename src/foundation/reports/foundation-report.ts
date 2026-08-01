import type { PrismaClient } from '../../generated/prisma/client.js';

export interface EconomyReconciliationRow {
  characterId: string;
  currency: 'SILVER' | 'GOLD';
  ledgerBalance: number;
  actualBalance: number;
  difference: number;
}

export async function buildEconomyReconciliation(
  prisma: PrismaClient,
): Promise<{ balanced: boolean; rows: EconomyReconciliationRow[] }> {
  const rows = await prisma.$queryRaw<EconomyReconciliationRow[]>`
    WITH ledger AS (
      SELECT
        "characterId",
        "currency"::text AS currency,
        COALESCE(SUM(CASE WHEN "direction" = 'CREDIT' THEN "amount" ELSE -"amount" END), 0)::int AS "ledgerBalance"
      FROM "CharacterCurrencyLedger"
      GROUP BY "characterId", "currency"
    ), expected AS (
      SELECT "id" AS "characterId", 'SILVER'::text AS currency, "silver" AS "actualBalance" FROM "Character"
      UNION ALL
      SELECT "id" AS "characterId", 'GOLD'::text AS currency, "gold" AS "actualBalance" FROM "Character"
    )
    SELECT
      expected."characterId",
      expected.currency,
      COALESCE(ledger."ledgerBalance", 0)::int AS "ledgerBalance",
      expected."actualBalance"::int AS "actualBalance",
      (expected."actualBalance" - COALESCE(ledger."ledgerBalance", 0))::int AS difference
    FROM expected
    LEFT JOIN ledger USING ("characterId", currency)
    ORDER BY ABS(expected."actualBalance" - COALESCE(ledger."ledgerBalance", 0)) DESC, expected."characterId"
  `;
  return { balanced: rows.every((row) => row.difference === 0), rows };
}

export async function buildProductReport(prisma: PrismaClient): Promise<Record<string, unknown>> {
  const [funnel, retention, sessions, itemFlow, combat, skills, operations] = await Promise.all([
    prisma.$queryRaw<Array<{ step: string; actors: number }>>`
      SELECT type AS step,
        COUNT(DISTINCT COALESCE("accountId"::text, "characterId"::text, "sessionId"))::int AS actors
      FROM "DomainEvent"
      WHERE type IN (
        'account.created', 'character.created', 'map.entered', 'combat.started',
        'quest.choice', 'group.created', 'group.member.joined'
      )
      GROUP BY type
      ORDER BY type
    `,
    prisma.$queryRaw<Array<{ day: string; retained: number; cohort: number }>>`
      WITH first_seen AS (
        SELECT "accountId", MIN("occurredAt"::date) AS first_day
        FROM "DomainEvent"
        WHERE "accountId" IS NOT NULL
        GROUP BY "accountId"
      ), activity AS (
        SELECT DISTINCT "accountId", "occurredAt"::date AS active_day
        FROM "DomainEvent"
        WHERE "accountId" IS NOT NULL
      ), targets(day, offset_days) AS (VALUES ('D1', 1), ('D7', 7), ('D30', 30))
      SELECT targets.day,
        COUNT(*) FILTER (WHERE activity."accountId" IS NOT NULL)::int AS retained,
        COUNT(*)::int AS cohort
      FROM first_seen
      CROSS JOIN targets
      LEFT JOIN activity
        ON activity."accountId" = first_seen."accountId"
       AND activity.active_day = first_seen.first_day + targets.offset_days
      GROUP BY targets.day, targets.offset_days
      ORDER BY targets.offset_days
    `,
    prisma.$queryRaw<Array<{ sessions: number; averageMs: number | null; p95Ms: number | null }>>`
      WITH starts AS (
        SELECT "sessionId", MIN("occurredAt") AS started
        FROM "DomainEvent"
        WHERE type = 'session.started' AND "sessionId" IS NOT NULL
        GROUP BY "sessionId"
      ), finishes AS (
        SELECT "sessionId", MAX("occurredAt") AS finished
        FROM "DomainEvent"
        WHERE type = 'session.ended' AND "sessionId" IS NOT NULL
        GROUP BY "sessionId"
      ), durations AS (
        SELECT EXTRACT(EPOCH FROM (finishes.finished - starts.started)) * 1000 AS duration_ms
        FROM starts JOIN finishes USING ("sessionId")
        WHERE finishes.finished >= starts.started
      )
      SELECT COUNT(*)::int AS sessions,
        AVG(duration_ms)::float8 AS "averageMs",
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::float8 AS "p95Ms"
      FROM durations
    `,
    prisma.$queryRaw<Array<{ type: string; events: number; quantity: number }>>`
      SELECT type,
        COUNT(*)::int AS events,
        COALESCE(SUM(NULLIF(payload->>'quantity', '')::int), 0)::int AS quantity
      FROM "DomainEvent"
      WHERE type IN ('item.acquired', 'item.consumed', 'item.destroyed', 'item.traded')
      GROUP BY type
      ORDER BY type
    `,
    prisma.$queryRaw<Array<{ combats: number; medianMs: number | null; p95Ms: number | null; medianTurnMs: number | null; p95TurnMs: number | null }>>`
      WITH finished AS (
        SELECT NULLIF(payload->>'durationMs', '')::float8 AS duration_ms
        FROM "DomainEvent"
        WHERE type = 'combat.finished' AND payload ? 'durationMs'
      ), turns AS (
        SELECT NULLIF(payload->>'turnDurationMs', '')::float8 AS turn_ms
        FROM "DomainEvent"
        WHERE type = 'combat.action.accepted' AND payload ? 'turnDurationMs'
      )
      SELECT
        (SELECT COUNT(*)::int FROM finished) AS combats,
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::float8 FROM finished) AS "medianMs",
        (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::float8 FROM finished) AS "p95Ms",
        (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY turn_ms)::float8 FROM turns) AS "medianTurnMs",
        (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY turn_ms)::float8 FROM turns) AS "p95TurnMs"
    `,
    prisma.$queryRaw<Array<{ skillKey: string; uses: number; totalDamage: number; totalHealing: number }>>`
      SELECT COALESCE(payload->>'skillKey', 'basic-attack') AS "skillKey",
        COUNT(*)::int AS uses,
        COALESCE(SUM(NULLIF(payload->>'damage', '')::int), 0)::int AS "totalDamage",
        COALESCE(SUM(NULLIF(payload->>'healing', '')::int), 0)::int AS "totalHealing"
      FROM "DomainEvent"
      WHERE type = 'combat.action.accepted'
      GROUP BY COALESCE(payload->>'skillKey', 'basic-attack')
      ORDER BY uses DESC
    `,
    prisma.$queryRaw<Array<{ pending: number; processing: number; deadLetter: number; contentFailures: number }>>`
      SELECT
        COUNT(*) FILTER (WHERE "status" = 'PENDING')::int AS pending,
        COUNT(*) FILTER (WHERE "status" = 'PROCESSING')::int AS processing,
        COUNT(*) FILTER (WHERE "status" = 'DEAD_LETTER')::int AS "deadLetter",
        (SELECT COUNT(*)::int FROM "ContentVersion" WHERE "status" = 'FAILED') AS "contentFailures"
      FROM "EventOutbox"
    `,
  ]);

  return {
    generatedAt: new Date().toISOString(),
    funnel,
    retention,
    sessions: sessions[0] ?? null,
    itemFlow,
    combat: combat[0] ?? null,
    skills,
    operations: operations[0] ?? null,
  };
}
