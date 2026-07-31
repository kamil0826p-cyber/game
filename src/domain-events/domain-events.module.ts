import { Global, Module } from '@nestjs/common';
import { DomainEventService } from './domain-event.service.js';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';

@Global()
@Module({
  providers: [DomainEventService, OutboxDispatcherService],
  exports: [DomainEventService, OutboxDispatcherService],
})
export class DomainEventsModule {}
