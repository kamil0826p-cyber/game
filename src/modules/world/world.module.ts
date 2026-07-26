import { Module } from '@nestjs/common';
import { SpatialIndexService } from './spatial-index.service.js';
import { VisibilityService } from './visibility.service.js';
import { WorldEventsPublisher } from './world-events.publisher.js';
import { WorldStateService } from './world-state.service.js';

@Module({
  providers: [SpatialIndexService, WorldStateService, WorldEventsPublisher, VisibilityService],
  exports: [SpatialIndexService, WorldStateService, WorldEventsPublisher, VisibilityService],
})
export class WorldModule {}
