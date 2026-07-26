import { Module } from '@nestjs/common';
import { ActorsModule } from './actors/actors.module.js';
import { ChatModule } from './chat/chat.module.js';
import { CombatModule } from './combat/combat.module.js';
import { EquipmentModule } from './equipment/equipment.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { QuestsModule } from './quests/quests.module.js';
import { SkillsModule } from './skills/skills.module.js';
import { StatsModule } from './stats/stats.module.js';
import { TradeModule } from './trade/trade.module.js';

@Module({
  imports: [
    CombatModule,
    SkillsModule,
    InventoryModule,
    EquipmentModule,
    StatsModule,
    QuestsModule,
    ActorsModule,
    ChatModule,
    TradeModule,
  ],
})
export class FutureFeaturesModule {}
