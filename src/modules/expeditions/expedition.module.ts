import { Module } from '@nestjs/common';
import { GroupModule } from '../groups/group.module.js';
import { ItemModule } from '../items/item.module.js';
import { MovementModule } from '../movement/movement.module.js';
import { SkillModule } from '../skills/skill.module.js';
import { WorldModule } from '../world/world.module.js';
import { ExpeditionCatalogService } from './expedition-catalog.service.js';
import { ExpeditionGateway } from './expedition.gateway.js';
import { ExpeditionPersistence } from './expedition.persistence.js';
import { ExpeditionService } from './expedition.service.js';

@Module({
  imports: [GroupModule, ItemModule, MovementModule, SkillModule, WorldModule],
  providers: [
    ExpeditionCatalogService,
    ExpeditionPersistence,
    ExpeditionService,
    ExpeditionGateway,
  ],
  exports: [ExpeditionService],
})
export class ExpeditionModule {}
