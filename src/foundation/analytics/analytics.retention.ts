import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { AnalyticsDispatcher } from './analytics.provider.js';

@Injectable()
export class AnalyticsRetentionService implements OnModuleInit, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsDispatcher,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.cleanup(), 24 * 60 * 60 * 1_000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async cleanup(): Promise<number> {
    const cutoff = new Date(Date.now() - this.analytics.retentionDays * 24 * 60 * 60 * 1_000);
    const deleted = await this.prisma.$executeRaw`
      DELETE FROM "DomainEvent" AS event
      USING "EventOutbox" AS outbox
      WHERE outbox."eventId" = event."id"
        AND outbox."status" = 'DELIVERED'::"OutboxStatus"
        AND event."occurredAt" < ${cutoff}
    `;
    return deleted;
  }
}
