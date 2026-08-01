import { Module } from '@nestjs/common';
import { WorldModule } from '../world/world.module.js';
import { NarrativeGateway } from './narrative.gateway.js';
import { NarrativePersistence } from './narrative.persistence.js';
import { NarrativeService } from './narrative.service.js';

@Module({
  imports: [WorldModule],
  providers: [NarrativePersistence, NarrativeService, NarrativeGateway],
  exports: [NarrativeService],
})
export class NarrativeModule {}
