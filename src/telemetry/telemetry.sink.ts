import type { TelemetryEnvelope } from './telemetry.contracts.js';

export const TELEMETRY_SINK = Symbol('TELEMETRY_SINK');

export interface TelemetrySink {
  send(events: readonly TelemetryEnvelope[]): Promise<void>;
}

export class NoopTelemetrySink implements TelemetrySink {
  async send(_events: readonly TelemetryEnvelope[]): Promise<void> {}
}

export class HttpTelemetrySink implements TelemetrySink {
  constructor(
    private readonly endpoint: string,
    private readonly timeoutMs = 5000,
  ) {}

  async send(events: readonly TelemetryEnvelope[]): Promise<void> {
    if (events.length === 0) return;
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Telemetry endpoint returned ${response.status}.`);
    }
  }
}
