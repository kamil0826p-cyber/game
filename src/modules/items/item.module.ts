import { Module } from '@nestjs/common';
import { MovementModule } from '../movement/movement.module.js';
import { ProgressionModule } from '../progression/progression.module.js';
import { WorldModule } from '../world/world.module.js';
import { ItemGateway } from './item.gateway.js';
import { ItemService } from './item.service.js';

@Module({
  imports: [WorldModule, MovementModule, ProgressionModule],
  providers: [ItemService, ItemGateway],
  exports: [ItemService],
})
export class ItemModule {}
