import { Module } from '@nestjs/common';
import { ItemModule } from '../../items/item.module.js';
import { MovementModule } from '../../movement/movement.module.js';
import { WorldModule } from '../../world/world.module.js';
import { ItemizedTradeService } from './itemized-trade.service.js';
import { TradeGateway } from './trade.gateway.js';
import { TradeService } from './trade.service.js';

@Module({
  imports: [ItemModule, MovementModule, WorldModule],
  providers: [
    ItemizedTradeService,
    { provide: TradeService, useExisting: ItemizedTradeService },
    TradeGateway,
  ],
  exports: [TradeService],
})
export class TradeModule {}
