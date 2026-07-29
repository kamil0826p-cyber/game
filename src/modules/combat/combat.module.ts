import { Module } from '@nestjs/common';
import { KeyedSerialExecutor } from '../../common/utils/keyed-serial-executor.js';
import { MapModule } from '../maps/map.module.js';
import { MovementModule } from '../movement/movement.module.js';
import { PersistenceModule } from '../persistence/persistence.module.js';
import { TradeModule } from '../player/trade/trade.module.js';
import { SkillModule } from '../skills/skill.module.js';
import { WorldModule } from '../world/world.module.js';
import { CombatGateway } from './combat.gateway.js';
import { CombatService } from './combat.service.js';

@Module({
  imports: [MapModule, MovementModule, PersistenceModule, TradeModule, SkillModule, WorldModule],
  providers: [KeyedSerialExecutor, CombatService, CombatGateway],
  exports: [CombatService],
})
export class CombatModule {}
