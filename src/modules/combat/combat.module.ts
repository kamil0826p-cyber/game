import { Module } from '@nestjs/common';
import { KeyedSerialExecutor } from '../../common/utils/keyed-serial-executor.js';
import { GroupModule } from '../groups/group.module.js';
import { MapModule } from '../maps/map.module.js';
import { MovementModule } from '../movement/movement.module.js';
import { PersistenceModule } from '../persistence/persistence.module.js';
import { TradeModule } from '../player/trade/trade.module.js';
import { PvpGateway } from '../pvp/pvp.gateway.js';
import { PvpModule } from '../pvp/pvp.module.js';
import { SkillModule } from '../skills/skill.module.js';
import { WorldModule } from '../world/world.module.js';
import { CombatOccupancyService } from './combat-occupancy.service.js';
import { CombatGateway } from './combat.gateway.js';
import { CombatService } from './combat.service.js';
import { PvpCombatIntegrationService } from './pvp-combat.integration.js';

@Module({
  imports: [
    GroupModule,
    MapModule,
    MovementModule,
    PersistenceModule,
    TradeModule,
    PvpModule,
    SkillModule,
    WorldModule,
  ],
  providers: [
    KeyedSerialExecutor,
    CombatOccupancyService,
    CombatService,
    PvpCombatIntegrationService,
    CombatGateway,
    PvpGateway,
  ],
  exports: [CombatOccupancyService, CombatService],
})
export class CombatModule {}
