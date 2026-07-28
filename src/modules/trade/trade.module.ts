import { Module } from '@nestjs/common';
import { MovementModule } from '../movement/movement.module.js';
import { WorldModule } from '../world/world.module.js';
import { TradeGateway } from './trade.gateway.js';
import { TradeService } from './trade.service.js';

@Module({
  imports: [WorldModule, MovementModule],
  providers: [TradeService, TradeGateway],
  exports: [TradeService],
})
export class TradeModule {}
