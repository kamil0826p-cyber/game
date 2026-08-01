import { Logger } from '@nestjs/common';
import type { DomainEventEnvelope } from '../events/domain-event.types.js';

export type AnalyticsProviderKind = 'disabled' | 'stdout' | 'http';

export interface AnalyticsProvider {
  readonly kind: AnalyticsProviderKind;
  publish(events: readonly DomainEventEnvelope[]): Promise<void>;
}

export interface AnalyticsProviderConfig {
  provider: AnalyticsProviderKind;
  httpUrl?: string;
  httpTimeoutMs: number;
}

class DisabledAnalyticsProvider implements AnalyticsProvider {
  readonly kind = 'disabled' as const;
  async publish(): Promise<void> {}
}

class StdoutAnalyticsProvider implements AnalyticsProvider {
  readonly kind = 'stdout' as const;

  async publish(events: readonly DomainEventEnvelope[]): Promise<void> {
    for (const event of events) console.log(JSON.stringify({ analytics: event }));
  }
}

class HttpAnalyticsProvider implements AnalyticsProvider {
  readonly kind = 'http' as const;

  constructor(
    private readonly url: string,
    private readonly timeoutMs: number,
  ) {}

  async publish(events: readonly DomainEventEnvelope[]): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref?.();
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': events.map((event) => event.id).join(','),
        },
        body: JSON.stringify({ events }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Analytics HTTP provider returned ${response.status}.`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function analyticsProviderConfigFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): AnalyticsProviderConfig {
  const provider = (environment.ANALYTICS_PROVIDER ?? 'disabled').toLowerCase();
  if (!['disabled', 'stdout', 'http'].includes(provider)) {
    throw new Error(`Unsupported ANALYTICS_PROVIDER ${provider}.`);
  }
  const httpTimeoutMs = Number(environment.ANALYTICS_HTTP_TIMEOUT_MS ?? 3_000);
  if (!Number.isInteger(httpTimeoutMs) || httpTimeoutMs < 100 || httpTimeoutMs > 60_000) {
    throw new Error('ANALYTICS_HTTP_TIMEOUT_MS must be an integer between 100 and 60000.');
  }
  const httpUrl = environment.ANALYTICS_HTTP_URL;
  if (provider === 'http' && !httpUrl) {
    throw new Error('ANALYTICS_HTTP_URL is required for the http analytics provider.');
  }
  return {
    provider: provider as AnalyticsProviderKind,
    httpUrl,
    httpTimeoutMs,
  };
}

export function createAnalyticsProvider(
  config: AnalyticsProviderConfig,
  logger = new Logger('AnalyticsProvider'),
): AnalyticsProvider {
  switch (config.provider) {
    case 'disabled':
      logger.log('Analytics provider is disabled.');
      return new DisabledAnalyticsProvider();
    case 'stdout':
      logger.log('Analytics provider uses stdout.');
      return new StdoutAnalyticsProvider();
    case 'http':
      logger.log('Analytics provider uses HTTP delivery.');
      return new HttpAnalyticsProvider(config.httpUrl!, config.httpTimeoutMs);
  }
}
