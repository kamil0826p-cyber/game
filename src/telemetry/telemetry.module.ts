import { Global, Module } from '@nestjs/common';
import { GameConfigModule } from '../config/game-config.module.js';
import { GameConfigService } from '../config/game-config.service.js';
import { TelemetryService } from './telemetry.service.js';
import {
  HttpTelemetrySink,
  NoopTelemetrySink,
  TELEMETRY_SINK,
  type TelemetrySink,
} from './telemetry.sink.js';

@Global()
@Module({
  imports: [GameConfigModule],
  providers: [
    {
      provide: TELEMETRY_SINK,
      inject: [GameConfigService],
      useFactory: (config: GameConfigService): TelemetrySink => {
        const endpoint = config.values.TELEMETRY_ENDPOINT;
        return config.values.TELEMETRY_ENABLED && endpoint
          ? new HttpTelemetrySink(endpoint, config.values.TELEMETRY_REQUEST_TIMEOUT_MS)
          : new NoopTelemetrySink();
      },
    },
    TelemetryService,
  ],
  exports: [TelemetryService],
})
export class TelemetryModule {}
