import { Module } from '@nestjs/common';
import { KeyedSerialExecutor } from '../../common/utils/keyed-serial-executor.js';
import { MapModule } from '../maps/map.module.js';
import { PersistenceModule } from '../persistence/persistence.module.js';
import { TradeModule } from '../player/trade/trade.module.js';
import { SkillModule } from '../skills/skill.module.js';
import { WorldModule } from '../world/world.module.js';
import { MobCoordinatorService } from './mob-coordinator.service.js';
import { MobGateway } from './mob.gateway.js';
import { MobRewardService } from './mob-reward.service.js';
import { PveCombatService } from './pve-combat.service.js';

@Module({
  imports: [MapModule, PersistenceModule, TradeModule, SkillModule, WorldModule],
  providers: [
    KeyedSerialExecutor,
    MobRewardService,
    MobCoordinatorService,
    PveCombatService,
    MobGateway,
  ],
  exports: [MobCoordinatorService, PveCombatService],
})
export class MobModule {}
