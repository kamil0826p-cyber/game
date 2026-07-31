import { Global, Module } from '@nestjs/common';
import { AnalyticsDispatcherService } from './analytics-dispatcher.service.js';
import { AnalyticsExperimentService } from './analytics-experiment.service.js';
import { AnalyticsIngestionService } from './analytics-ingestion.service.js';
import { AnalyticsProviderService } from './analytics-provider.service.js';
import { AnalyticsTrackingService } from './analytics-tracking.service.js';

@Global()
@Module({
  providers: [
    AnalyticsProviderService,
    AnalyticsIngestionService,
    AnalyticsDispatcherService,
    AnalyticsExperimentService,
    AnalyticsTrackingService,
  ],
  exports: [AnalyticsExperimentService, AnalyticsTrackingService],
})
export class AnalyticsModule {}
