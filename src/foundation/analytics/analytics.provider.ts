import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import type { DomainEventEnvelope } from '../events/domain-event.types.js';
import { sanitizeAnalyticsPayload } from './analytics.sanitizer.js';

const analyticsEnvironmentSchema = z.object({
  ANALYTICS_PROVIDER: z.enum(['disabled', 'stdout', 'http']).default('disabled'),
  ANALYTICS_HTTP_URL: z.string().url().optional(),
  ANALYTICS_HTTP_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(3_000),
  ANALYTICS_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
  ANALYTICS_RETENTION_DAYS: z.coerce.number().int().min(1).max(3_650).default(90),
});

export type AnalyticsConfiguration = z.infer<typeof analyticsEnvironmentSchema>;

export const analyticsConfiguration = (): AnalyticsConfiguration => {
  const parsed = analyticsEnvironmentSchema.safeParse(process.env);
  if (!parsed.success) throw new Error(`Invalid analytics configuration: ${parsed.error.message}`);
  if (parsed.data.ANALYTICS_PROVIDER === 'http' && !parsed.data.ANALYTICS_HTTP_URL) {
    throw new Error('ANALYTICS_HTTP_URL is required when ANALYTICS_PROVIDER=http.');
  }
  return parsed.data;
};

const sampled = (eventId: string, rate: number): boolean => {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  const value = createHash('sha256').update(eventId).digest().readUInt32BE(0) / 0xffff_ffff;
  return value < rate;
};

@Injectable()
export class AnalyticsDispatcher {
  private readonly logger = new Logger(AnalyticsDispatcher.name);
  private readonly config = analyticsConfiguration();

  get retentionDays(): number {
    return this.config.ANALYTICS_RETENTION_DAYS;
  }

  async dispatch(event: DomainEventEnvelope): Promise<'delivered' | 'skipped'> {
    if (this.config.ANALYTICS_PROVIDER === 'disabled') return 'skipped';
    if (!event.critical && !sampled(event.id, this.config.ANALYTICS_SAMPLE_RATE)) return 'skipped';

    const payload = sanitizeAnalyticsPayload(event);
    if (this.config.ANALYTICS_PROVIDER === 'stdout') {
      this.logger.log(JSON.stringify(payload));
      return 'delivered';
    }

    const response = await fetch(this.config.ANALYTICS_HTTP_URL!, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': event.id,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.config.ANALYTICS_HTTP_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Analytics provider returned HTTP ${response.status}.`);
    }
    return 'delivered';
  }
}
