import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { sanitizeAnalyticsPayload } from '../analytics/analytics.sanitizer.js';
import type { DomainEventEnvelope, DomainEventInput } from './domain-event.types.js';

const criticalType = (type: string): boolean =>
  type.startsWith('currency.') ||
  type.startsWith('item.') ||
  type.startsWith('combat.') ||
  type.startsWith('quest.reward');

@Injectable()
export class DomainEventRecorder {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: DomainEventInput): Promise<DomainEventEnvelope> {
    return this.prisma.$transaction((transaction) => this.recordInTransaction(transaction, input));
  }

  async recordInTransaction(
    transaction: Prisma.TransactionClient,
    input: DomainEventInput,
  ): Promise<DomainEventEnvelope> {
    const activeContent = await transaction.activeContentVersion.findUnique({
      where: { id: 'active' },
      include: { contentVersion: { select: { hash: true } } },
    });
    const id = randomUUID();
    const occurredAt = new Date();
    const sanitizedPayload = sanitizeAnalyticsPayload(input.payload) as Prisma.InputJsonValue;
    const critical = input.critical ?? criticalType(input.type);
    const context = input.context ?? {};

    await transaction.domainEvent.create({
      data: {
        id,
        type: input.type,
        version: input.version,
        occurredAt,
        realmId: context.realmId,
        mapId: context.mapId,
        characterId: context.characterId,
        accountId: context.accountId,
        sessionId: context.sessionId,
        operationId: context.operationId,
        correlationId: context.correlationId,
        contentVersionHash: activeContent?.contentVersion.hash,
        clientVersion: context.clientVersion,
        payload: sanitizedPayload,
        critical,
        outbox: { create: {} },
      },
    });

    return {
      id,
      type: input.type,
      version: input.version,
      occurredAt,
      ...context,
      contentVersionHash: activeContent?.contentVersion.hash,
      payload: sanitizedPayload,
      critical,
    };
  }
}
