import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import type {
  AppendedDomainEvent,
  DomainContribution,
  DomainEventInput,
  DomainEventRecord,
} from './domain-event.types.js';

type SqlClient = Pick<Prisma.TransactionClient, '$queryRaw' | '$executeRaw'>;

function assertEventInput(input: DomainEventInput): void {
  if (!input.operationId.trim() || input.operationId.length > 160) {
    throw new Error('Domain event operationId must contain 1-160 characters.');
  }
  if (!input.type.trim() || input.type.length > 120) {
    throw new Error('Domain event type must contain 1-120 characters.');
  }
  for (const contribution of input.payload.contributions ?? []) {
    assertContribution(contribution);
  }
}

function assertContribution(value: DomainContribution): void {
  if (!['CHARACTER', 'PARTY', 'GUILD', 'REALM'].includes(value.subjectType)) {
    throw new Error(`Invalid contribution subject type ${value.subjectType}.`);
  }
  if (!value.subjectId.trim() || value.subjectId.length > 128) {
    throw new Error('Contribution subjectId must contain 1-128 characters.');
  }
  if (!value.kind.trim() || value.kind.length > 96) {
    throw new Error('Contribution kind must contain 1-96 characters.');
  }
  if (!Number.isInteger(value.amount) || value.amount < 1) {
    throw new Error('Contribution amount must be a positive integer.');
  }
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

export async function appendDomainEvent(
  tx: SqlClient,
  input: DomainEventInput,
): Promise<AppendedDomainEvent> {
  assertEventInput(input);
  const eventId = input.eventId ?? randomUUID();
  const deduplicationKey = input.deduplicationKey ?? `${input.type}:${input.operationId}`;
  if (deduplicationKey.length > 200) throw new Error('Domain event deduplication key is too long.');
  const rows = await tx.$queryRaw<DomainEventRecord[]>(Prisma.sql`
    INSERT INTO "DomainEvent" (
      "id", "deduplicationKey", "operationId", "type", "schemaVersion",
      "actorCharacterId", "realmId", "mapId", "regionKey", "payload", "occurredAt", "createdAt"
    ) VALUES (
      ${eventId}::uuid, ${deduplicationKey}, ${input.operationId}, ${input.type},
      ${input.schemaVersion ?? 1}, ${input.actorCharacterId ?? null}::uuid,
      ${input.realmId ?? null}::uuid, ${input.mapId ?? null}::uuid,
      ${input.regionKey ?? null}, ${JSON.stringify(input.payload)}::jsonb,
      ${input.occurredAt ?? new Date()}, NOW()
    )
    ON CONFLICT ("deduplicationKey") DO NOTHING
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
  const existing = await readDomainEventByDeduplicationKey(tx, deduplicationKey);
  if (!existing) throw new Error(`Domain event ${deduplicationKey} conflicted but could not be read.`);
  if (existing.operationId !== input.operationId || existing.type !== input.type) {
    throw new Error(`Domain event deduplication collision for ${deduplicationKey}.`);
  }
  return { event: existing, created: false };
}

export async function readDomainEvent(
  client: SqlClient,
  eventId: string,
): Promise<DomainEventRecord | null> {
  const rows = await client.$queryRaw<DomainEventRecord[]>(Prisma.sql`
    SELECT * FROM "DomainEvent" WHERE "id" = ${eventId}::uuid LIMIT 1
  `);
  return rows[0] ?? null;
}

async function readDomainEventByDeduplicationKey(
  client: SqlClient,
  deduplicationKey: string,
): Promise<DomainEventRecord | null> {
  const rows = await client.$queryRaw<DomainEventRecord[]>(Prisma.sql`
    SELECT * FROM "DomainEvent" WHERE "deduplicationKey" = ${deduplicationKey} LIMIT 1
  `);
  return rows[0] ?? null;
}
