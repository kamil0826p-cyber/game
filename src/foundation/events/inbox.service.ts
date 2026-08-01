import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { DomainEventEnvelope } from './domain-event.types.js';

interface InboxEventRow {
  id: string;
  eventType: string;
  eventVersion: number;
  occurredAt: Date;
  serverTime: Date;
  realmId: string | null;
  mapId: string | null;
  characterId: string | null;
  accountId: string | null;
  sessionId: string | null;
  operationId: string | null;
  correlationId: string | null;
  contentHash: string | null;
  clientVersion: string | null;
  payload: unknown;
}

export type InboxHandler<TResult> = (
  transaction: Prisma.TransactionClient,
  event: DomainEventEnvelope,
) => Promise<TResult>;

export interface InboxConsumeResult<TResult> {
  processed: boolean;
  result?: TResult;
}

function toEnvelope(row: InboxEventRow): DomainEventEnvelope {
  return {
    id: row.id,
    eventType: row.eventType,
    eventVersion: row.eventVersion,
    occurredAt: row.occurredAt,
    serverTime: row.serverTime,
    ...(row.realmId ? { realmId: row.realmId } : {}),
    ...(row.mapId ? { mapId: row.mapId } : {}),
    ...(row.characterId ? { characterId: row.characterId } : {}),
    ...(row.accountId ? { accountId: row.accountId } : {}),
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    ...(row.operationId ? { operationId: row.operationId } : {}),
    ...(row.correlationId ? { correlationId: row.correlationId } : {}),
    ...(row.contentHash ? { contentHash: row.contentHash } : {}),
    ...(row.clientVersion ? { clientVersion: row.clientVersion } : {}),
    payload: row.payload,
  };
}

@Injectable()
export class InboxService {
  constructor(private readonly prisma: PrismaService) {}

  async consume<TResult>(
    consumer: string,
    eventId: string,
    handler: InboxHandler<TResult>,
  ): Promise<InboxConsumeResult<TResult>> {
    if (!consumer.trim() || consumer.length > 160) {
      throw new Error('Inbox consumer name must contain 1-160 characters.');
    }

    return this.prisma.$transaction(async (transaction) => {
      const claims = await transaction.$queryRaw<Array<{ eventId: string }>>(Prisma.sql`
        INSERT INTO "DomainInbox" ("consumer", "eventId")
        VALUES (${consumer}, ${eventId}::uuid)
        ON CONFLICT ("consumer", "eventId") DO NOTHING
        RETURNING "eventId"
      `);
      if (claims.length === 0) return { processed: false };

      const rows = await transaction.$queryRaw<InboxEventRow[]>(Prisma.sql`
        SELECT
          "id", "eventType", "eventVersion", "occurredAt", "serverTime",
          "realmId", "mapId", "characterId", "accountId", "sessionId",
          "operationId", "correlationId", "contentHash", "clientVersion", "payload"
        FROM "DomainEvent"
        WHERE "id" = ${eventId}::uuid
        LIMIT 1
      `);
      const row = rows[0];
      if (!row) throw new Error(`Domain event ${eventId} does not exist.`);

      const result = await handler(transaction, toEnvelope(row));
      await transaction.$executeRaw(Prisma.sql`
        UPDATE "DomainInbox"
        SET "processedAt" = CURRENT_TIMESTAMP,
            "resultHash" = encode(digest(${JSON.stringify(result ?? null)}, 'sha256'), 'hex')
        WHERE "consumer" = ${consumer}
          AND "eventId" = ${eventId}::uuid
      `);
      return { processed: true, result };
    });
  }
}
