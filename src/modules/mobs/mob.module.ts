import { Module } from '@nestjs/common';
import { KeyedSerialExecutor } from '../../common/utils/keyed-serial-executor.js';
import { CharacterModule } from '../characters/character.module.js';
import { CombatModule } from '../combat/combat.module.js';
import { ExpeditionModule } from '../expeditions/expedition.module.js';
import { GroupModule } from '../groups/group.module.js';
import { ItemModule } from '../items/item.module.js';
import { MapModule } from '../maps/map.module.js';
import { MovementModule } from '../movement/movement.module.js';
import { PersistenceModule } from '../persistence/persistence.module.js';
import { TradeModule } from '../player/trade/trade.module.js';
import { QuestModule } from '../quests/quest.module.js';
import { SkillModule } from '../skills/skill.module.js';
import { WorldModule } from '../world/world.module.js';
import { MobCoordinatorService } from './mob-coordinator.service.js';
import { MobGateway } from './mob.gateway.js';
import { MobRewardService } from './mob-reward.service.js';
import { PveCombatService } from './pve-combat.service.js';

@Module({
  imports: [
    CharacterModule,
    CombatModule,
    ExpeditionModule,
    GroupModule,
    ItemModule,
    MapModule,
    MovementModule,
    PersistenceModule,
    TradeModule,
    QuestModule,
    SkillModule,
    WorldModule,
  ],
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
