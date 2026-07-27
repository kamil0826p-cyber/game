import { Module } from '@nestjs/common';
import { WorldModule } from '../world/world.module.js';
import { ItemGateway } from './item.gateway.js';
import { ItemService } from './item.service.js';

@Module({
  imports: [WorldModule],
  providers: [ItemService, ItemGateway],
  exports: [ItemService],
})
export class ItemModule {}
