import { Module } from '@nestjs/common';
import { AnalyticsDispatcher } from './analytics/analytics.provider.js';
import { AnalyticsRetentionService } from './analytics/analytics.retention.js';
import { DomainEventRecorder } from './events/domain-event.recorder.js';
import { ExactlyOnceEventConsumer, OutboxWorker } from './events/outbox.worker.js';
import { FeatureFlagService } from './feature-flags/feature-flag.service.js';

@Module({
  providers: [
    AnalyticsDispatcher,
    AnalyticsRetentionService,
    DomainEventRecorder,
    OutboxWorker,
    ExactlyOnceEventConsumer,
    FeatureFlagService,
  ],
  exports: [DomainEventRecorder, ExactlyOnceEventConsumer, FeatureFlagService],
})
export class FoundationModule {}
