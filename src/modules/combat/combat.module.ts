import { Module } from '@nestjs/common';
import { KeyedSerialExecutor } from '../../common/utils/keyed-serial-executor.js';
import { GroupModule } from '../groups/group.module.js';
import { ItemModule } from '../items/item.module.js';
import { MapModule } from '../maps/map.module.js';
import { MovementModule } from '../movement/movement.module.js';
import { NpcModule } from '../npcs/npc.module.js';
import { PersistenceModule } from '../persistence/persistence.module.js';
import { TradeModule } from '../player/trade/trade.module.js';
import { SkillModule } from '../skills/skill.module.js';
import { WorldModule } from '../world/world.module.js';
import { CombatOccupancyService } from './combat-occupancy.service.js';
import { CombatGateway } from './combat.gateway.js';
import './item-curse-combat.patch.js';
import { CombatService } from './combat.service.js';
import { DefeatRecoveryService } from './defeat-recovery.service.js';

@Module({
  imports: [
    GroupModule,
    ItemModule,
    MapModule,
    MovementModule,
    NpcModule,
    PersistenceModule,
    TradeModule,
    SkillModule,
    WorldModule,
  ],
  providers: [
    KeyedSerialExecutor,
    CombatOccupancyService,
    CombatService,
    DefeatRecoveryService,
    CombatGateway,
  ],
  exports: [CombatOccupancyService, CombatService],
})
export class CombatModule {}
