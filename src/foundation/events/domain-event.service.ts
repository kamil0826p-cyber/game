import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { sanitizeAnalyticsPayload } from '../analytics/payload-sanitizer.js';
import type { EmitDomainEventInput } from './domain-event.types.js';

type EventTransaction = Prisma.TransactionClient;

@Injectable()
export class DomainEventService {
  constructor(private readonly prisma: PrismaService) {}

  async emit<TPayload>(input: EmitDomainEventInput<TPayload>): Promise<string> {
    return this.prisma.$transaction((transaction) => this.emitInTransaction(transaction, input));
  }

  async emitInTransaction<TPayload>(
    transaction: EventTransaction,
    input: EmitDomainEventInput<TPayload>,
  ): Promise<string> {
    const eventId = input.id ?? randomUUID();
    const eventVersion = input.eventVersion ?? 1;
    if (!Number.isInteger(eventVersion) || eventVersion <= 0) {
      throw new Error('Domain event version must be a positive integer.');
    }
    const sanitized = sanitizeAnalyticsPayload(input.payload);
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "DomainEvent" (
        "id", "eventType", "eventVersion", "occurredAt", "serverTime",
        "realmId", "mapId", "characterId", "accountId", "sessionId",
        "operationId", "correlationId", "contentHash", "clientVersion", "payload"
      ) VALUES (
        ${eventId}::uuid,
        ${input.eventType},
        ${eventVersion},
        ${input.occurredAt ?? new Date()},
        CURRENT_TIMESTAMP,
        ${input.realmId ?? null}::uuid,
        ${input.mapId ?? null}::uuid,
        ${input.characterId ?? null}::uuid,
        ${input.accountId ?? null}::uuid,
        ${input.sessionId ?? null},
        ${input.operationId ?? null},
        ${input.correlationId ?? null},
        COALESCE(${input.contentHash ?? null}, foundation_active_content_hash()),
        ${input.clientVersion ?? null},
        CAST(${JSON.stringify(sanitized ?? {})} AS jsonb)
      )
      ON CONFLICT ("id") DO NOTHING
    `);
    await transaction.$executeRaw(Prisma.sql`
      INSERT INTO "DomainOutbox" ("eventId")
      VALUES (${eventId}::uuid)
      ON CONFLICT ("eventId") DO NOTHING
    `);
    return eventId;
  }
}
