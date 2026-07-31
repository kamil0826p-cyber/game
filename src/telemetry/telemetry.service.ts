import { Inject, Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { GameConfigService } from '../config/game-config.service.js';
import {
  parseTelemetryPayload,
  telemetryContextSchema,
  type TelemetryContext,
  type TelemetryEnvelope,
  type TelemetryEventName,
} from './telemetry.contracts.js';
import { TELEMETRY_SINK, type TelemetrySink } from './telemetry.sink.js';

export interface TelemetryQueueStats {
  queued: number;
  dropped: number;
  sent: number;
  failures: number;
}

@Injectable()
export class TelemetryService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(TelemetryService.name);
  private readonly queue: TelemetryEnvelope[] = [];
  private timer?: NodeJS.Timeout;
  private activeFlush?: Promise<void>;
  private dropped = 0;
  private sent = 0;
  private failures = 0;

  constructor(
    private readonly config: GameConfigService,
    @Inject(TELEMETRY_SINK) private readonly sink: TelemetrySink,
  ) {}

  onModuleInit(): void {
    if (!this.config.values.TELEMETRY_ENABLED) return;
    this.timer = setInterval(() => {
      void this.flush().catch((error: unknown) => {
        this.logger.warn(
          `Telemetry flush failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }, this.config.values.TELEMETRY_FLUSH_MS);
    this.timer.unref();
  }

  emit(name: TelemetryEventName, context: TelemetryContext, payload: unknown): boolean {
    if (!this.config.values.TELEMETRY_ENABLED) return false;
    try {
      const envelope: TelemetryEnvelope = {
        eventId: randomUUID(),
        name,
        schemaVersion: 1,
        occurredAt: new Date().toISOString(),
        serverVersion: process.env.npm_package_version ?? 'unknown',
        context: telemetryContextSchema.parse(context),
        payload: parseTelemetryPayload(name, payload),
      };
      if (this.queue.length >= this.config.values.TELEMETRY_MAX_QUEUE) {
        this.queue.shift();
        this.dropped += 1;
      }
      this.queue.push(envelope);
      if (this.queue.length >= this.config.values.TELEMETRY_BATCH_SIZE) {
        void this.flush().catch((error: unknown) => {
          this.logger.warn(
            `Telemetry flush failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
      return true;
    } catch (error) {
      this.logger.warn(
        `Rejected invalid telemetry event ${name}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  flush(): Promise<void> {
    if (!this.config.values.TELEMETRY_ENABLED || this.queue.length === 0) {
      return Promise.resolve();
    }
    if (this.activeFlush) return this.activeFlush;
    this.activeFlush = this.performFlush().finally(() => {
      this.activeFlush = undefined;
    });
    return this.activeFlush;
  }

  getStats(): TelemetryQueueStats {
    return {
      queued: this.queue.length,
      dropped: this.dropped,
      sent: this.sent,
      failures: this.failures,
    };
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    const deadline = Date.now() + this.config.values.TELEMETRY_SHUTDOWN_TIMEOUT_MS;
    while (this.queue.length > 0 && Date.now() < deadline) {
      try {
        await this.flush();
      } catch {
        break;
      }
    }
    if (this.queue.length > 0) {
      this.logger.warn(`Dropping ${this.queue.length} telemetry events during shutdown.`);
      this.dropped += this.queue.length;
      this.queue.length = 0;
    }
  }

  private async performFlush(): Promise<void> {
    const batch = this.queue.splice(0, this.config.values.TELEMETRY_BATCH_SIZE);
    if (batch.length === 0) return;
    try {
      await this.sink.send(batch);
      this.sent += batch.length;
    } catch (error) {
      this.failures += 1;
      const available = Math.max(0, this.config.values.TELEMETRY_MAX_QUEUE - this.queue.length);
      const retry = batch.slice(Math.max(0, batch.length - available));
      this.queue.unshift(...retry);
      this.dropped += batch.length - retry.length;
      throw error;
    }
  }
}
