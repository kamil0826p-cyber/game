import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { validateDomainEventInput } from './domain-event.contracts.js';
import type { AppendedDomainEvent, DomainEventInput, DomainEventRecord } from './domain-event.types.js';

type SqlClient = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

@Injectable()
export class DomainEventService {
  constructor(private readonly prisma: PrismaService) {}

  append(tx: SqlClient, input: DomainEventInput): Promise<AppendedDomainEvent> {
    return appendDomainEvent(tx, input);
  }

  async appendInTransaction(input: DomainEventInput): Promise<AppendedDomainEvent> {
    return this.prisma.$transaction((tx) => appendDomainEvent(tx, input));
  }

  async consumeExactlyOnce<T>(
    consumer: string,
    eventId: string,
    handler: (tx: Prisma.TransactionClient, event: DomainEventRecord) => Promise<T>,
  ): Promise<{ processed: boolean; result?: T }> {
    if (!consumer.trim() || consumer.length > 120) throw new Error('Consumer name must contain 1-120 characters.');
    return this.prisma.$transaction(async (tx) => {
      const event = await readDomainEvent(tx, eventId);
      if (!event) throw new Error(`Domain event ${eventId} does not exist.`);
      const receipts = await tx.$queryRaw<Array<{ consumer: string }>>(Prisma.sql`
        INSERT INTO "EventInbox" ("consumer", "eventId", "processedAt")
        VALUES (${consumer}, ${eventId}::uuid, NOW())
        ON CONFLICT ("consumer", "eventId") DO NOTHING
        RETURNING "consumer"
      `);
      if (receipts.length === 0) return { processed: false };
      return { processed: true, result: await handler(tx, event) };
    });
  }
}

export async function appendDomainEvent(tx: SqlClient, input: DomainEventInput): Promise<AppendedDomainEvent> {
  validateDomainEventInput(input);
  const eventId = input.eventId ?? randomUUID();
  const schemaVersion = input.schemaVersion ?? 1;
  const deduplicationKey = input.deduplicationKey ?? `${input.type}:${input.operationId}`;
  if (!deduplicationKey.trim() || deduplicationKey.length > 200) {
    throw new Error('Domain event deduplication key must contain 1-200 characters.');
  }
  const payloadJson = stableJson(input.payload);
  const rows = await tx.$queryRaw<DomainEventRecord[]>(Prisma.sql`
    INSERT INTO "DomainEvent" (
      "id", "deduplicationKey", "operationId", "type", "schemaVersion",
      "actorCharacterId", "realmId", "mapId", "regionKey", "payload", "occurredAt", "createdAt"
    ) VALUES (
      ${eventId}::uuid, ${deduplicationKey}, ${input.operationId}, ${input.type},
      ${schemaVersion}, ${input.actorCharacterId ?? null}::uuid,
      ${input.realmId ?? null}::uuid, ${input.mapId ?? null}::uuid,
      ${input.regionKey ?? null}, ${payloadJson}::jsonb,
      ${input.occurredAt ?? new Date()}, NOW()
    )
    ON CONFLICT DO NOTHING
    RETURNING *
  `);
  if (rows[0]) {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "EventOutbox" ("id", "eventId", "status", "nextAttemptAt", "createdAt", "updatedAt")
      VALUES (${randomUUID()}::uuid, ${rows[0].id}::uuid, 'PENDING', NOW(), NOW(), NOW())
      ON CONFLICT ("eventId") DO NOTHING
    `);
    return { event: rows[0], created: true };
  }

  const existing = await readDomainEventByIdentity(tx, input.type, input.operationId, deduplicationKey);
  if (!existing) throw new Error(`Domain event ${deduplicationKey} conflicted but could not be read.`);
  if (
    existing.operationId !== input.operationId ||
    existing.type !== input.type ||
    existing.schemaVersion !== schemaVersion ||
    stableJson(existing.payload) !== payloadJson
  ) {
    throw new Error(`Domain event deduplication collision for ${deduplicationKey}.`);
  }
  return { event: existing, created: false };
}

export async function readDomainEvent(client: SqlClient, eventId: string): Promise<DomainEventRecord | null> {
  const rows = await client.$queryRaw<DomainEventRecord[]>(Prisma.sql`
    SELECT * FROM "DomainEvent" WHERE "id" = ${eventId}::uuid LIMIT 1
  `);
  return rows[0] ?? null;
}

async function readDomainEventByIdentity(
  client: SqlClient,
  type: DomainEventInput['type'],
  operationId: string,
  deduplicationKey: string,
): Promise<DomainEventRecord | null> {
  const rows = await client.$queryRaw<DomainEventRecord[]>(Prisma.sql`
    SELECT * FROM "DomainEvent"
    WHERE "deduplicationKey" = ${deduplicationKey}
       OR ("type" = ${type} AND "operationId" = ${operationId})
    ORDER BY CASE WHEN "deduplicationKey" = ${deduplicationKey} THEN 0 ELSE 1 END
    LIMIT 1
  `);
  return rows[0] ?? null;
}

export interface DomainEventReplayFilter {
  type?: DomainEventInput['type'];
  from?: Date;
  to?: Date;
  includeDead?: boolean;
}

export async function requeueDomainEvents(client: SqlClient, filter: DomainEventReplayFilter = {}): Promise<number> {
  if (filter.from && filter.to && filter.from.getTime() > filter.to.getTime()) {
    throw new Error('Replay from date cannot be later than to date.');
  }
  return client.$executeRaw(Prisma.sql`
    UPDATE "EventOutbox" AS outbox
    SET "status" = 'PENDING', "attempts" = 0, "nextAttemptAt" = NOW(),
        "lockedAt" = NULL, "publishedAt" = NULL, "lastError" = NULL, "updatedAt" = NOW()
    FROM "DomainEvent" AS event
    WHERE outbox."eventId" = event."id"
      AND (${filter.type ?? null}::text IS NULL OR event."type" = ${filter.type ?? null})
      AND (${filter.from ?? null}::timestamptz IS NULL OR event."occurredAt" >= ${filter.from ?? null})
      AND (${filter.to ?? null}::timestamptz IS NULL OR event."occurredAt" <= ${filter.to ?? null})
      AND (${filter.includeDead ?? true} OR outbox."status" <> 'DEAD')
  `);
}
