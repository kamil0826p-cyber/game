import { Module } from '@nestjs/common';
import { KeyedSerialExecutor } from '../../common/utils/keyed-serial-executor.js';
import { GroupModule } from '../groups/group.module.js';
import { MapModule } from '../maps/map.module.js';
import { MovementModule } from '../movement/movement.module.js';
import { PersistenceModule } from '../persistence/persistence.module.js';
import { TradeModule } from '../player/trade/trade.module.js';
import { SkillModule } from '../skills/skill.module.js';
import { WorldModule } from '../world/world.module.js';
import { CombatOccupancyService } from './combat-occupancy.service.js';
import { CombatTelegraphService } from './combat-telegraph.service.js';
import { CombatGateway } from './combat.gateway.js';
import { CombatService } from './combat.service.js';

@Module({
  imports: [
    GroupModule,
    MapModule,
    MovementModule,
    PersistenceModule,
    TradeModule,
    SkillModule,
    WorldModule,
  ],
  providers: [
    KeyedSerialExecutor,
    CombatOccupancyService,
    CombatTelegraphService,
    CombatService,
    CombatGateway,
  ],
  exports: [CombatOccupancyService, CombatTelegraphService, CombatService],
})
export class CombatModule {}
