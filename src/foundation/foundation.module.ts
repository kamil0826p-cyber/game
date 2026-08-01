import { Global, Module } from '@nestjs/common';
import { DomainEventService } from './events/domain-event.service.js';
import { InboxService } from './events/inbox.service.js';
import { OutboxService } from './events/outbox.service.js';
import { FeatureFlagService } from './flags/feature-flag.service.js';

@Global()
@Module({
  providers: [DomainEventService, InboxService, OutboxService, FeatureFlagService],
  exports: [DomainEventService, InboxService, OutboxService, FeatureFlagService],
})
export class FoundationModule {}
