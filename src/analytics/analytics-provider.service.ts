import { Injectable, Logger } from '@nestjs/common';
import { GameConfigService } from '../config/game-config.service.js';
import type { AnalyticsEnvelope, AnalyticsProvider } from './analytics.types.js';

class StdoutAnalyticsProvider implements AnalyticsProvider {
  readonly kind = 'stdout' as const;
  constructor(private readonly logger: Logger) {}
  async send(batch: readonly AnalyticsEnvelope[]): Promise<void> {
    this.logger.log(JSON.stringify({ analytics: batch }));
  }
}

class HttpAnalyticsProvider implements AnalyticsProvider {
  readonly kind = 'http' as const;
  constructor(
    private readonly endpoint: string,
    private readonly authorization: string | undefined,
    private readonly timeoutMs: number,
  ) {}

  async send(batch: readonly AnalyticsEnvelope[]): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    timeout.unref?.();
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.authorization ? { authorization: this.authorization } : {}),
        },
        body: JSON.stringify({ events: batch }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Analytics provider returned HTTP ${response.status}.`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

@Injectable()
export class AnalyticsProviderService {
  private readonly logger = new Logger(AnalyticsProviderService.name);
  private readonly provider?: AnalyticsProvider;

  constructor(config: GameConfigService) {
    const values = config.values;
    if (!values.ANALYTICS_ENABLED || values.ANALYTICS_PROVIDER === 'disabled') return;
    if (values.ANALYTICS_PROVIDER === 'stdout') {
      this.provider = new StdoutAnalyticsProvider(this.logger);
      return;
    }
    if (!values.ANALYTICS_HTTP_ENDPOINT) {
      this.logger.warn('ANALYTICS_PROVIDER=http is disabled because ANALYTICS_HTTP_ENDPOINT is empty.');
      return;
    }
    this.provider = new HttpAnalyticsProvider(
      values.ANALYTICS_HTTP_ENDPOINT,
      values.ANALYTICS_HTTP_AUTHORIZATION,
      values.ANALYTICS_HTTP_TIMEOUT_MS,
    );
  }

  get active(): AnalyticsProvider | undefined {
    return this.provider;
  }
}
